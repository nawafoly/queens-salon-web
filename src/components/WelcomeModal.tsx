import React from "react";

interface WelcomeModalProps {
  show: boolean;
  userName: string;
  userRole: string;
  onClose: () => void;
}

const WelcomeModal: React.FC<WelcomeModalProps> = ({
  show,
  userName,
  userRole,
  onClose,
}) => {
  if (!show) return null;

  const roleLabel =
    userRole && userRole !== "client" ? `(${userRole})` : "";

  return (
    <div className="welcome-backdrop" onClick={onClose}>
      <div
        className="welcome-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="welcome-title">
          مرحبًا بك {userName} {roleLabel}
        </h2>

        <p className="welcome-text">
          يسعدنا تواجدك معنا 🌸 نتمنى لك تجربة جميلة ومميزة
        </p>

        <button className="welcome-btn" onClick={onClose}>
          دخول
        </button>
      </div>
    </div>
  );
};

export default WelcomeModal;
