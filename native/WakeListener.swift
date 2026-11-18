import Foundation
import AVFoundation
import Speech

func matchesWake(_ text: String) -> Bool {
    let words = text.lowercased().split { !$0.isLetter }.map(String.init)
    return zip(words, words.dropFirst()).contains(where: { $0 == "hey" && $1 == "iris" })
}
@_cdecl("iris_wake_matches")
public func irisWakeMatches(_ text: UnsafePointer<CChar>) -> Int32 { matchesWake(String(cString: text)) ? 1 : 0 }
// Only fixed status/error messages cross the C boundary. Recognition text stays here.
public typealias WakeCallback = @convention(c) (UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
final class WakeListener {
    static let shared = WakeListener()
    var callback: WakeCallback?
    var activation = ""
    var enabled = false
    var desired = false
    var epoch = 0
    var engine: AVAudioEngine?
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var renewal: DispatchWorkItem?
    func emit(_ status: String, _ message: String = "") {
        activation.withCString { id in status.withCString { state in message.withCString { detail in callback?(id, state, detail) } } }
    }
    func cleanup() {
        epoch += 1
        renewal?.cancel(); renewal = nil
        engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
    }
    func fail(_ message: String) { cleanup(); enabled = false; desired = false; emit("error", message) }
    func start(_ id: String, _ cb: @escaping WakeCallback) {
        cleanup(); activation = id; callback = cb; enabled = true; desired = true
        emit("authorizing")
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard self.enabled && self.activation == id else { return }
                guard status == .authorized else { self.fail("Allow Speech Recognition for Iris in macOS Privacy & Security, then enable the wake phrase again."); return }
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        guard self.enabled && self.activation == id else { return }
                        guard allowed else { self.fail("Allow Microphone access for Iris in macOS Privacy & Security."); return }
                        if self.desired { self.listen() } else { self.emit("paused") }
                    }
                }
            }
        }
    }
    func listen() {
        guard enabled && desired else { return }
        cleanup()
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            fail("On-device English speech recognition is unavailable. Enable or download English speech support in macOS settings, then try again."); return
        }
        let current = epoch
        let audio = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.contextualStrings = ["Hey Iris"]
        let format = audio.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0 && format.channelCount > 0 else { fail("No microphone input is available."); return }
        self.engine = audio; self.request = request
        audio.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                guard self.enabled && self.desired && self.epoch == current else { return }
                if let result = result {
                    if matchesWake(result.bestTranscription.formattedString) {
                        self.desired = false; self.cleanup(); self.emit("detected"); return
                    }
                    if result.isFinal { self.listen(); return }
                }
                if error != nil { self.fail("Local wake listening stopped. Check your microphone and macOS speech support, then enable it again.") }
            }
        }
        do { audio.prepare(); try audio.start(); emit("listening") }
        catch { fail("The local wake microphone could not start."); return }
        let renewal = DispatchWorkItem { [weak self] in
            guard let self = self, self.epoch == current && self.enabled && self.desired else { return }
            self.listen()
        }
        self.renewal = renewal
        DispatchQueue.main.asyncAfter(deadline: .now() + 50, execute: renewal)
    }
    func pause() { desired = false; cleanup(); if enabled { emit("paused") } }
    func resume() {
        guard enabled else { return }
        desired = true
        guard SFSpeechRecognizer.authorizationStatus() == .authorized && AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { return }
        listen()
    }
    func stop() { enabled = false; desired = false; cleanup(); emit("off"); callback = nil }
}
@_cdecl("iris_wake_start")
public func irisWakeStart(_ id: UnsafePointer<CChar>, _ callback: @escaping WakeCallback) {
    let activation = String(cString: id)
    DispatchQueue.main.async { WakeListener.shared.start(activation, callback) }
}
@_cdecl("iris_wake_control")
public func irisWakeControl(_ action: Int32) {
    DispatchQueue.main.async {
        switch action { case 1: WakeListener.shared.pause(); case 2: WakeListener.shared.resume(); default: WakeListener.shared.stop() }
    }
}
