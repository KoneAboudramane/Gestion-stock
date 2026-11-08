import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import BoutonAgrandirModales from "./components/BoutonAgrandirModales";
import { initialiserTheme } from "./lib/theme";
import "./index.css";
import "../../partage/styles/admin.css";

initialiserTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <BoutonAgrandirModales />
  </React.StrictMode>,
);
