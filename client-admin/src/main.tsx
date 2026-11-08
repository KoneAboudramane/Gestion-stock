import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";
import "../../partage/styles/admin-base.css";
import "../../partage/styles/admin.css";
import "../../partage/styles/themes.css";
import { initialiserTheme } from "./theme";

// Dernier thème connu dans ce navigateur, avant le premier rendu (celui du compte suit, avec /admin/moi/).
initialiserTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
