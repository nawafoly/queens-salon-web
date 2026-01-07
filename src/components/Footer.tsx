import React from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faInstagram,
  faYoutube,
  faTwitter,
  faSnapchat,
  faFacebookF,
  faTiktok,
} from "@fortawesome/free-brands-svg-icons";

import logo from "../assets/images/logo-whait.png";
import "../styles/Footer.css";

const Footer: React.FC = () => {
  return (
    <footer className="footer-dark">
      <div className="footer-inner">
        {/* Logo */}
        <div className="footer-col footer-col--logo">
          <img src={logo} alt="Queens Salon" className="footer-logo" />
        </div>

        {/* Links */}
        <div className="footer-col">
          <h4>روابط تهمك</h4>
          <ul>
            <li>
              <Link to="/terms">الشروط والأحكام</Link>
            </li>
            <li>
              <Link to="/privacy">سياسة الخصوصية</Link>
            </li>
          </ul>
        </div>

        {/* Contact + Social */}
        <div className="footer-col">
          <h4>معلومات التواصل</h4>
          <p>تواصلي الآن مع فريقنا المتخصص لاختيار أفضل الخدمات</p>

          <div className="social-links">
            <a href="#" aria-label="Instagram">
              <FontAwesomeIcon icon={faInstagram} />
            </a>
            <a href="#" aria-label="YouTube">
              <FontAwesomeIcon icon={faYoutube} />
            </a>
            <a href="#" aria-label="Twitter">
              <FontAwesomeIcon icon={faTwitter} />
            </a>
            <a href="#" aria-label="Snapchat">
              <FontAwesomeIcon icon={faSnapchat} />
            </a>
            <a href="#" aria-label="Facebook">
              <FontAwesomeIcon icon={faFacebookF} />
            </a>
            <a href="#" aria-label="TikTok">
              <FontAwesomeIcon icon={faTiktok} />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>© جميع الحقوق محفوظة لصالون ملكات 2025</p>
      </div>
    </footer>
  );
};

export default Footer;
  