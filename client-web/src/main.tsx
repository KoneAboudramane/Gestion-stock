import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { SessionProvider } from "./contexts/SessionContext";
import { initialiserTheme } from "./lib/theme";
import "./index.css";

initialiserTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </React.StrictMode>,
);
