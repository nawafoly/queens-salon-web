import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Bootstrap
import "bootstrap/dist/css/bootstrap.min.css";

// CSS العام
import "./index.css";
import "./styles/DashboardSkin.css";
import "./styles/MadanAdminTheme.css";

if (import.meta.env.DEV) {
  void import("./services/firestoreDebug");
}

import App from "./App";

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
