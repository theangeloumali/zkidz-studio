// Created by The Angelo Umali.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing #root");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
