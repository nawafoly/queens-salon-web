import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "bootstrap/dist/css/bootstrap.min.css";

import "./index.css";
import "./styles/DashboardSkin.css";
import "./styles/MadanAdminTheme.css";
import "./styles/EmployeePortalMobileUxV2.css";
import "./styles/EmployeePortalStandalone.css";

import App from "./App";
import AndroidBackButtonHandler from "./components/AndroidBackButtonHandler";

if (import.meta.env.DEV) {
  void import("./services/firestoreDebug");
}

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <BrowserRouter>
    <AndroidBackButtonHandler />
    <App />
  </BrowserRouter>
);
