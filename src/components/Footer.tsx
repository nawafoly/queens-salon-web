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

import logo from "../assets/images/ssunnamed.png";
import "../styles/Footer.css";

const INSTAGRAM_URL =
  "https://www.instagram.com/malikat_sallon?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==";

const Footer: React.FC = () => {
  return (
    <footer className="footer-dark" dir="rtl">
      <div className="footer-inner">
        {/* Logo */}
        <div className="footer-col footer-col--logo">
          <img
            src={logo}
            alt="صالون ملكات"
            className="footer-logo"
          />
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
            <a href={INSTAGRAM_URL} aria-label="Instagram" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faInstagram} />
            </a>
            <a href="#" aria-label="YouTube" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faYoutube} />
            </a>
            <a href="#" aria-label="Twitter" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faTwitter} />
            </a>
            <a href="#" aria-label="Snapchat" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faSnapchat} />
            </a>
            <a href="#" aria-label="Facebook" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faFacebookF} />
            </a>
            <a href="#" aria-label="TikTok" target="_blank" rel="noopener noreferrer">
              <FontAwesomeIcon icon={faTiktok} />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p> المبرمج نواف العليان © جميع الحقوق محفوظة لصالون ملكات 2026</p>
      </div>
    </footer>
  );
};

export default Footer;
