import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Bootstrap
import "bootstrap/dist/css/bootstrap.min.css";

// CSS العام
import "./index.css";

// 🔴 هنا المكان الصحيح
import "./services/firestoreDebug";

import App from "./App";

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
