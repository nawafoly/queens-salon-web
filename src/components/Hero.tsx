import ssunnamed from "../assets/images/ssunnamed.png";
import { Link } from "react-router-dom";
import "../styles/Hero.css";

const Hero = () => {
  return (
    <section className="hero-section">
      <div className="hero-container">
        <div className="hero-content">
          
          {/* Logo / Image */}
          <div className="hero-image">
            <img
              src={ssunnamed}
              alt="صالون ملكات"
              className="logo-belak-img"
            />
          </div>

          {/* Text Content */}
          <h1 className="hero-title">
            مرحباً بكم في صالون ملكات
          </h1>

          <p className="hero-text">
            نقدم لكِ أفضل خدمات التجميل والعناية بالبشرة والشعر في مكان واحد.
            فريقنا من الخبراء يضمن لكِ تجربة فريدة وراقية.
          </p>

          {/* Actions */}
          <div className="hero-buttons">
            <Link to="/booking" className="btn hero-booking-btn">
              احجزي الآن
            </Link>

            <Link to="/services" className="btn hero-explore-btn">
              استكشفي خدماتنا
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
};

export default Hero;
