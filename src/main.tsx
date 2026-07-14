import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./gameplay-responsive.css";
import "./design-polish.css";
import "./immersive-design.css";
import "./gameplay-legibility.css";
import "./gameplay-craft.css";
import "./victory-sequence.css";
import "./generated-design.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="board-sdk-theme radix-themes">
      <App />
    </div>
  </StrictMode>
);
