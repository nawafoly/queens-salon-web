import React, { useState } from 'react';
import ava from "../assets/images/ava.webp";
import emma from "../assets/images/emma.webp";
import sophie from "../assets/images/sophie.webp";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStar, faQuoteRight, faUser, faEnvelope, faPaperPlane } from '@fortawesome/free-solid-svg-icons';

interface ReviewFormData {
  name: string;
  email: string;
  rating: number;
  review: string;
}

interface Review {
  id: number;
  name: string;
  rating: number;
  date: string;
  text: string;
  image: string;
}

const Reviews: React.FC = () => {
  const [formData, setFormData] = useState<ReviewFormData>({
    name: '',
    email: '',
    rating: 5,
    review: ''
  });

  const [reviews] = useState<Review[]>([
    {
      id: 1,
      name: 'سارة الأحمد',
      rating: 5,
      date: '2025-05-15',
      text: 'تجربة رائعة في صالون ملكات ! الخدمة ممتازة والنتيجة أكثر من رائعة. سأعود بالتأكيد مرة أخرى. أنصح به بشدة لكل من تبحث عن خدمة احترافية وجودة عالية.',
      image: ava
    },
    {
      id: 2,
      name: 'نورة العتيبي',
      rating: 5,
      date: '2025-05-10',
      text: 'أفضل صالون تجميل زرته! الموظفات محترفات والمكان نظيف وراقي. أنصح به بشدة. استمتعت بتجربة العناية بالشعر وكانت النتائج مذهلة. سأعود قريباً لتجربة خدمات أخرى.',
      image: emma
    },
    {
      id: 3,
      name: 'هند السعيد',
      rating: 4,
      date: '2025-05-05',
      text: 'خدمة ممتازة وأسعار معقولة. استمتعت بتجربة العناية بالبشرة وكانت النتائج مذهلة. الموظفات ودودات ومحترفات. المكان مريح وهادئ. أنصح بتجربة خدمات العناية بالبشرة.',
      image: sophie
    },
    {
      id: 4,
      name: 'منى الشمري',
      rating: 5,
      date: '2025-04-28',
      text: 'تجربة لا تُنسى! قمت بعمل مكياج لمناسبة خاصة وكانت النتيجة رائعة. الخبيرة فهمت طلبي تماماً ونفذته باحترافية عالية. سأعود بالتأكيد مرة أخرى.',
      image: null
    },
    {
      id: 5,
      name: 'ريم القحطاني',
      rating: 4,
      date: '2025-04-20',
      text: 'صالون راقي وخدمة ممتازة. استمتعت بجلسة المانيكير والباديكير. الموظفات محترفات والمكان نظيف جداً. الأسعار مناسبة مقارنة بالخدمة المقدمة.',
      image: null
    },
    {
      id: 6,
      name: 'لمى العنزي',
      rating: 5,
      date: '2025-04-15',
      text: 'من أفضل صالونات التجميل! جربت خدمة صبغ الشعر وكانت النتيجة مذهلة. الخبيرة اختارت لي اللون المناسب وطبقته باحترافية. سأعود قريباً لتجربة خدمات أخرى.',
      image: null
    }
  ]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));
  };

  const handleRatingChange = (rating: number) => {
    setFormData(prevState => ({
      ...prevState,
      rating
    }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // هنا يمكن إضافة منطق إرسال التقييم إلى الخادم
    console.log('Review submitted:', formData);
    alert('شكراً لك! تم إرسال تقييمك بنجاح وسيتم مراجعته قريباً.');
    setFormData({
      name: '',
      email: '',
      rating: 5,
      review: ''
    });
  };

  const renderStars = (rating: number) => {
    const stars: React.ReactElement[] = [];
    for (let i = 0; i < 5; i++) {
      stars.push(
        <FontAwesomeIcon
          key={i}
          icon={faStar}
          className={i < rating ? "star-filled" : "star-empty"}
        />
      );
    }
    return stars;
  };


  // تنسيق التاريخ بالعربية
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric' as const,
      month: 'long' as const,
      day: 'numeric' as const
    };
    return date.toLocaleDateString('ar-SA', options);
  };

  return (
    <div className="reviews-page py-5">
      <div className="container">
        <h1 className="reviews-title text-center mb-2">آراء العميلات</h1>
        <p className="reviews-subtitle text-center mb-5">
          اطلعي على تجارب عميلاتنا وشاركينا رأيك في خدماتنا
        </p>

        <div className="row">
          <div className="col-lg-8 mb-5">
            <div className="reviews-list">
              {reviews.map((review) => (
                <div className="review-card mb-4" key={review.id}>
                  <div className="review-header">
                    <div className="review-author">
                      {review.image ? (
                        <div className="review-author-image">
                          <img src={review.image} alt={review.name} />
                        </div>
                      ) : (
                        <div className="review-author-avatar">
                          <FontAwesomeIcon icon={faUser} />
                        </div>
                      )}
                      <div className="review-author-info">
                        <h3 className="review-author-name">{review.name}</h3>
                        <div className="review-date">{formatDate(review.date)}</div>
                      </div>
                    </div>
                    <div className="review-rating">
                      {renderStars(review.rating)}
                    </div>
                  </div>
                  <div className="review-content">
                    <div className="review-quote">
                      <FontAwesomeIcon icon={faQuoteRight} />
                    </div>
                    <p className="review-text">{review.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-lg-4">
            <div className="review-form-container">
              <h2 className="review-form-title mb-4">شاركينا رأيك</h2>

              <form className="review-form" onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label htmlFor="name" className="form-label">الاسم</label>
                  <div className="input-group">
                    <span className="input-group-text">
                      <FontAwesomeIcon icon={faUser} />
                    </span>
                    <input
                      type="text"
                      className="form-control"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="أدخلي اسمك"
                      required
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label htmlFor="email" className="form-label">البريد الإلكتروني</label>
                  <div className="input-group">
                    <span className="input-group-text">
                      <FontAwesomeIcon icon={faEnvelope} />
                    </span>
                    <input
                      type="email"
                      className="form-control"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="أدخلي بريدك الإلكتروني"
                      required
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label">التقييم</label>
                  <div className="rating-selector">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span
                        key={star}
                        className={`rating-star ${formData.rating >= star ? 'active' : ''}`}
                        onClick={() => handleRatingChange(star)}
                      >
                        <FontAwesomeIcon icon={faStar} />
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label htmlFor="review" className="form-label">رأيك</label>
                  <textarea
                    className="form-control"
                    id="review"
                    name="review"
                    value={formData.review}
                    onChange={handleChange}
                    rows={5}
                    placeholder="شاركينا تجربتك مع صالون ملكات"
                    required
                  ></textarea>
                </div>

                <button type="submit" className="btn btn-primary rounded-pill w-100">
                  <FontAwesomeIcon icon={faPaperPlane} className="me-2" />
                  إرسال التقييم
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reviews;

