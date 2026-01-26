import Hero from "../components/Hero";
import Features from "../components/Features";
import HomeServices from "../components/HomeServices";
import Testimonials from "../components/Testimonials";

import "../styles/Home.css";

const Home = () => {
  return (
    <div className="home-page">
      <Hero />
      <Features />
      <HomeServices />
      <Testimonials />
    </div>
  );
};

export default Home;
