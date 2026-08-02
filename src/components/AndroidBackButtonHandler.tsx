import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { useLocation, useNavigate } from "react-router-dom";

const ROOT_PATHS = new Set([
  "/",
  "/hr",
  "/employee",
  "/dashboard",
  "/staff",
  "/login",
  "/hr/login",
  "/employee/login",
]);

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function getFallbackPath(pathname: string): string {
  if (pathname.startsWith("/employee")) return "/employee";
  if (pathname.startsWith("/hr")) return "/hr";
  if (pathname.startsWith("/dashboard")) return "/dashboard";
  if (pathname.startsWith("/staff")) return "/staff";
  return "/";
}

export default function AndroidBackButtonHandler() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== "android"
    ) {
      return;
    }

    let removeListener: (() => Promise<void>) | undefined;
    let disposed = false;

    void CapacitorApp.addListener("backButton", () => {
      const currentPath = normalizePath(pathname);

      if (ROOT_PATHS.has(currentPath)) {
        void CapacitorApp.minimizeApp();
        return;
      }

      if (window.history.length > 1) {
        navigate(-1);
        return;
      }

      navigate(getFallbackPath(currentPath), { replace: true });
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }

      removeListener = listener.remove;
    });

    return () => {
      disposed = true;
      if (removeListener) {
        void removeListener();
      }
    };
  }, [navigate, pathname]);

  return null;
}
