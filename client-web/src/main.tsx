import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import BoutonAgrandirModales from "./components/BoutonAgrandirModales";
import { SessionProvider } from "./contexts/SessionContext";
import { activerBoutonRetourAndroid } from "./lib/appliAndroid";
import { initialiserTheme } from "./lib/theme";
import "./index.css";

initialiserTheme();
activerBoutonRetourAndroid();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
      <BoutonAgrandirModales />
    </SessionProvider>
  </React.StrictMode>,
);
