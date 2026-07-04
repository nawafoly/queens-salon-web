
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpa, faAward, faUserFriends } from "@fortawesome/free-solid-svg-icons";

const Features = () => {
  const features = [
    {
      icon: faSpa,
      title: "خدمات متكاملة",
      description:
        "نقدم مجموعة متكاملة من خدمات التجميل والعناية بالبشرة والشعر في مكان واحد.",
    },
    {
      icon: faAward,
      title: "خبرة احترافية",
      description:
        "فريقنا من المتخصصات ذوات الخبرة الطويلة في مجال التجميل والعناية بالجمال.",
    },
    {
      icon: faUserFriends,
      title: "خصوصية تامة",
      description:
        "نضمن لكِ خصوصية تامة وراحة مطلقة في جميع خدماتنا مع الالتزام بأعلى معايير النظافة.",
    },
  ];

  return (
    <section className="features-section py-5">
      <div className="container">
        <h2 className="section-title text-center mb-5">ما يُميّزنا !</h2>

        <div className="row g-4">
          {features.map((feature, index) => (
            <div className="col-12 col-md-4" key={index}>
              <div
                className="feature-card"
                style={{ animationDelay: `${0.2 * (index + 1)}s` }}
              >
                <div className="feature-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={feature.icon} />
                </div>

                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
