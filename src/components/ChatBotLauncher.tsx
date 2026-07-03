import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots } from "@fortawesome/free-solid-svg-icons";
import "../styles/PublicFlows.css";

const ChatBotLauncher: React.FC = () => {
  return (
    <div className="chatbot">
      <Link to="/chat" className="chatbot-toggle" aria-label="دخول صفحة الشات">
        <FontAwesomeIcon icon={faCommentDots} />
      </Link>
    </div>
  );
};

export default ChatBotLauncher;
