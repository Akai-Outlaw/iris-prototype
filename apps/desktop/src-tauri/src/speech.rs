//! Provider transport shared by the desktop voice path and the credentialed CLI check.
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Default)]
pub struct Transcript {
    finals: BTreeMap<i64, String>,
}
impl Transcript {
    pub fn ingest(&mut self, value: &Value) -> Option<(String, bool, bool)> {
        if value["type"] != "Results" {
            return None;
        }
        let text = value["channel"]["alternatives"][0]["transcript"]
            .as_str()
            .unwrap_or("");
        let final_result = value["is_final"].as_bool().unwrap_or(false);
        if final_result && !text.trim().is_empty() {
            let start = (value["start"].as_f64().unwrap_or(0.) * 1_000_000.).round() as i64;
            self.finals.insert(start, text.into());
        }
        let committed = self.text();
        let display = if !final_result && !text.is_empty() {
            format!("{committed} {text}").trim().to_string()
        } else {
            committed
        };
        Some((display, final_result, value["speech_final"] == true))
    }
    pub fn text(&self) -> String {
        self.finals
            .values()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" ")
    }
}

pub fn validate_voice_id(voice: &str) -> Result<(), String> {
    if voice.is_empty()
        || voice.len() > 100
        || !voice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Select an ElevenLabs voice in Settings first.".into());
    }
    Ok(())
}

pub async fn stream_tts(
    secret: String,
    voice: &str,
    text: &str,
    generation: Arc<AtomicU64>,
    epoch: u64,
    mut audio: impl FnMut(Vec<u8>) -> Result<(), String>,
) -> Result<usize, String> {
    validate_voice_id(voice)?;
    if text.is_empty() || text.len() > 12000 {
        return Err("Speech requires between 1 and 12,000 characters.".into());
    }
    let url=format!("wss://api.elevenlabs.io/v1/text-to-speech/{voice}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000");
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(15), connect_async(&url))
        .await
        .map_err(|_| "ElevenLabs connection timed out")?
        .map_err(|_| "ElevenLabs connection failed. Check your network and API access.")?;
    if generation.load(Ordering::SeqCst) != epoch {
        return Ok(0);
    }
    socket.send(Message::Text(json!({"text":" ","xi_api_key":secret,"voice_settings":{"stability":0.55,"similarity_boost":0.75},"generation_config":{"chunk_length_schedule":[80,120,160,200]}}).to_string().into())).await.map_err(|_|"Voice transport disconnected")?;
    socket
        .send(Message::Text(
            json!({"text":format!("{text} "),"try_trigger_generation":true})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| "Voice transport disconnected")?;
    socket
        .send(Message::Text(json!({"text":""}).to_string().into()))
        .await
        .map_err(|_| "Voice transport disconnected")?;
    let (mut idle, mut total, mut finished) = (0, 0usize, false);
    loop {
        if generation.load(Ordering::SeqCst) != epoch {
            let _ = socket.close(None).await;
            return Ok(total);
        }
        match tokio::time::timeout(Duration::from_secs(1), socket.next()).await {
            Err(_) => {
                idle += 1;
                if idle > 20 {
                    return Err("ElevenLabs stopped responding. Text remains available.".into());
                }
            }
            Ok(Some(Ok(Message::Text(raw)))) => {
                idle = 0;
                let value: Value =
                    serde_json::from_str(&raw).map_err(|_| "Invalid voice response")?;
                if value.get("error").is_some_and(|e| !e.is_null()) || value.get("detail").is_some()
                {
                    return Err("ElevenLabs rejected speech generation. Check the voice ID, API-key permissions, and available credits.".into());
                }
                if let Some(encoded) = value["audio"].as_str() {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|_| "Invalid PCM audio response")?;
                    if bytes.len() > 1_000_000 || total + bytes.len() > 8_000_000 {
                        return Err("Speech exceeded its audio limit.".into());
                    }
                    total += bytes.len();
                    if generation.load(Ordering::SeqCst) == epoch && !bytes.is_empty() {
                        audio(bytes)?;
                    }
                }
                if value["isFinal"] == true {
                    finished = true;
                    break;
                }
            }
            Ok(None) | Ok(Some(Ok(Message::Close(_)))) => break,
            Ok(Some(Err(_))) => {
                return Err("ElevenLabs disconnected before finishing speech.".into())
            }
            _ => {}
        }
    }
    if total < 2 {
        return Err(
            "ElevenLabs returned no playable audio. Check the selected voice and account access."
                .into(),
        );
    }
    if total % 2 != 0 || !finished {
        return Err("Speech was incomplete. The full response is still available as text.".into());
    }
    Ok(total)
}

pub async fn recognize_sample(secret: String, pcm: &[u8]) -> Result<String, String> {
    let mut request="wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=24000&channels=1&smart_format=true".into_client_request().map_err(|_|"Invalid speech configuration")?;
    request.headers_mut().insert(
        "Authorization",
        format!("Token {secret}")
            .parse()
            .map_err(|_| "Invalid Deepgram key")?,
    );
    let (mut socket, _) = tokio::time::timeout(Duration::from_secs(15), connect_async(request))
        .await
        .map_err(|_| "Deepgram timed out")?
        .map_err(|_| "Deepgram rejected the connection. Check your API key and permissions.")?;
    for chunk in pcm.chunks(4096) {
        socket
            .send(Message::Binary(chunk.to_vec().into()))
            .await
            .map_err(|_| "Deepgram disconnected")?;
    }
    socket
        .send(Message::Text(
            json!({"type":"CloseStream"}).to_string().into(),
        ))
        .await
        .map_err(|_| "Deepgram disconnected")?;
    let mut transcript = Transcript::default();
    tokio::time::timeout(Duration::from_secs(25), async {
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Text(raw)) => {
                    let value: Value =
                        serde_json::from_str(&raw).map_err(|_| "Invalid Deepgram response")?;
                    if value["type"] == "Error" {
                        return Err("Deepgram rejected the audio test".to_string());
                    }
                    transcript.ingest(&value);
                }
                Ok(Message::Close(_)) => break,
                Err(_) => return Err("Deepgram stream disconnected".to_string()),
                _ => {}
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|_| "Deepgram did not finalize the audio test")??;
    let text = transcript.text();
    if text.is_empty() {
        Err("Deepgram returned no transcript for the test clip.".into())
    } else {
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn committed_transcripts_are_ordered_and_deduplicated() {
        let mut t = Transcript::default();
        for (start, text) in [(1, "world"), (0, "Hello"), (1, "world")] {
            t.ingest(&json!({"type":"Results","start":start,"is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":text}]}}));
        }
        assert_eq!(t.text(), "Hello world");
    }
    #[test]
    fn partials_are_visible_but_not_committed() {
        let mut t = Transcript::default();
        let event=t.ingest(&json!({"type":"Results","is_final":false,"channel":{"alternatives":[{"transcript":"unfinished"}]}})).unwrap();
        assert_eq!(event.0, "unfinished");
        assert_eq!(t.text(), "");
    }
    #[test]
    fn invalid_voice_ids_cannot_rewrite_the_provider_url() {
        for voice in ["", "../escape", "voice?api_key=secret"] {
            assert!(validate_voice_id(voice).is_err());
        }
        assert!(validate_voice_id("example-voice_123").is_ok());
    }
}
