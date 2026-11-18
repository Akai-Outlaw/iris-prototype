import { createRoot } from "react-dom/client";
import { applyTokens } from "@iris/design-tokens";
import { App } from "./App";
import "./styles.css";
applyTokens();
createRoot(document.getElementById("root")!).render(<App />);
