
import ava from '../assets/images/ava.jpg';
import emma from '../assets/images/emma.jpg';
import sophie from '../assets/images/sophie.jpg';
import unnamed from '../assets/images/unnamed.jpg';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faStar, faAward, faHandHoldingHeart } from '@fortawesome/free-solid-svg-icons';
import '../styles/About.css';

const About = () => {
  const teamMembers = [
    {
      id: 1,
      name: 'سارة الأحمد',
      position: 'مديرة الصالون',
      image: ava,
      description: 'خبرة أكثر من 10 سنوات في مجال التجميل والعناية بالبشرة.'
    },
    {
      id: 2,
      name: 'نورة العتيبي',
      position: 'أخصائية الشعر',
      image: emma,
      description: 'متخصصة في قص وصبغ الشعر بأحدث التقنيات العالمية.'
    },
    {
      id: 3,
      name: 'هند السعيد',
      position: 'خبيرة العناية بالبشرة',
      image: sophie,
      description: 'حاصلة على شهادات متخصصة في العناية بالبشرة والتجميل.'
    }
  ];

  const whyChooseUs = [
    {
      icon: faStar,
      title: 'خدمة متميزة',
      description: 'نقدم خدمة احترافية ومتميزة تلبي جميع احتياجاتك وتفوق توقعاتك.'
    },
    {
      icon: faAward,
      title: 'فريق محترف',
      description: 'فريقنا من الخبيرات المتخصصات في مجال التجميل والعناية بالجمال.'
    },
    {
      icon: faHandHoldingHeart,
      title: 'منتجات طبيعية',
      description: 'نستخدم منتجات طبيعية وآمنة على البشرة والشعر من أفضل الماركات العالمية.'
    }
  ];

  return (
    <div className="about-page py-5">
      <div className="container">
        <section className="about-intro mb-5">
          <div className="row align-items-center">
            <div className="col-lg-6 mb-4 mb-lg-0">
              <div className="about-image">
                <img src={unnamed} alt="Body Beauty Salon" className="img-fluid rounded" />
              </div>
            </div>

            <div className="col-lg-6">
              <div className="about-content">
                <h1 className="about-title mb-4">عن صالون ملكات</h1>
                <p className="about-text mb-4">
                  تأسس صالون ملكات للتجميل في عام 2020 بهدف تقديم خدمات تجميلية متكاملة وعالية الجودة للسيدات.
                  نسعى دائماً لتوفير تجربة فريدة ومميزة لعميلاتنا في جو من الراحة والخصوصية.
                </p>
                <p className="about-text mb-4">
                  يضم صالوننا فريقاً من الخبيرات المتخصصات في مجالات العناية بالشعر والبشرة والمكياج والأظافر،
                  ونستخدم أفضل المنتجات العالمية لضمان نتائج مثالية.
                </p>
                <p className="about-text">
                  رؤيتنا هي أن نكون الوجهة الأولى للسيدات الباحثات عن التميز والجودة في خدمات التجميل،
                  ونسعى دائماً لمواكبة أحدث صيحات الموضة والتجميل العالمية.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="about-team mb-5">
          <div className="text-center mb-5">
            <h2 className="section-title">فريقنا المتميز</h2>
            <p className="section-subtitle">
              تعرفي على فريق الخبيرات المتخصصات في صالون ملكات
            </p>
          </div>

          <div className="team-grid">
            {teamMembers.map((member, index) => (
              <div key={member.id}>
                <div
                  className="team-member-enhanced animate-fade-in"
                  style={{ animationDelay: `${index * 0.2}s` }}
                >
                  <div className="team-member-image-container">
                    <img
                      src={member.image}
                      alt={member.name}
                      className="team-member-image-enhanced"
                    />
                    <div className="team-member-overlay">
                      <div className="team-member-social">
                        <i className="fab fa-instagram"></i>
                        <i className="fab fa-twitter"></i>
                      </div>
                    </div>
                  </div>

                  <div className="team-member-content">
                    <h3 className="team-member-name-enhanced">{member.name}</h3>
                    <p className="team-member-position-enhanced">{member.position}</p>
                    <p className="team-member-description-enhanced">{member.description}</p>

                    <div className="team-member-skills">
                      <span className="skill-tag">خبيرة معتمدة</span>
                      <span className="skill-tag">10+ سنوات خبرة</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="why-choose-us">
          <h2 className="section-title text-center mb-5">لماذا تختارين صالون ملكات</h2>
          <div className="row">
            {whyChooseUs.map((item, index) => (
              <div className="col-md-4 mb-4" key={index}>
                <div className="why-choose-item">
                  <div className="why-choose-icon">
                    <FontAwesomeIcon icon={item.icon} />
                  </div>
                  <h3 className="why-choose-title">{item.title}</h3>
                  <p className="why-choose-description">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="about-features mt-5">
            <div className="row">
              <div className="col-lg-6 mb-4">
                <h3 className="about-features-title mb-4">ماذا يميزنا؟</h3>
                <ul className="features-list">
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> أحدث التقنيات في مجال التجميل</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> منتجات عالمية ذات جودة عالية</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> أسعار مناسبة وعروض دورية</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> خصوصية تامة وراحة مطلقة</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> مواعيد مرنة تناسب جميع العميلات</li>
                </ul>
              </div>

              <div className="col-lg-6">
                <h3 className="about-features-title mb-4">قيمنا</h3>
                <ul className="features-list">
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> الاحترافية في تقديم الخدمات</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> الالتزام بأعلى معايير النظافة</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> الاهتمام بتفاصيل رغبات العميلات</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> التطوير المستمر لمهارات الفريق</li>
                  <li><FontAwesomeIcon icon={faCheck} className="feature-icon" /> الصدق والشفافية في التعامل</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;

