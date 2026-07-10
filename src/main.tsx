import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import App from "./App";
import "./styles.css";
import "./gameplay-responsive.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme className="board-sdk-theme" appearance="dark" accentColor="jade" grayColor="sand" radius="small" scaling="95%">
      <App />
    </Theme>
  </StrictMode>
);
