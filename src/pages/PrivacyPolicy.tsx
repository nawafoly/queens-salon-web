import { useEffect } from "react";
import { Link } from "react-router-dom";
import logo from "../assets/images/ssunnamed.png";
import "../styles/PrivacyPolicy.css";

const SUPPORT_EMAIL = "nawafaaa6@gmail.com";

const PrivacyPolicy = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "سياسة الخصوصية | صالون ملكات";

    const description =
      "سياسة خصوصية تطبيق صالون ملكات، وتشمل البيانات التي نجمعها وأسباب استخدامها وطرق حمايتها وحذفها.";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") || "";

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;

    return () => {
      document.title = previousTitle;
      if (meta) meta.content = previousDescription;
    };
  }, []);

  return (
    <main className="privacy-policy-page" dir="rtl">
      <section className="privacy-policy-hero" aria-labelledby="privacy-title">
        <div className="privacy-policy-hero__glow" aria-hidden="true" />
        <div className="privacy-policy-container privacy-policy-hero__content">
          <img className="privacy-policy-logo" src={logo} alt="شعار صالون ملكات" />
          <p className="privacy-policy-eyebrow">صالون ملكات</p>
          <h1 id="privacy-title">سياسة الخصوصية</h1>
          <p className="privacy-policy-intro">
            توضح هذه السياسة كيفية جمع بياناتك واستخدامها وحمايتها عند استخدام تطبيق
            صالون ملكات أو موقعه الإلكتروني وخدمات الحجز المرتبطة به.
          </p>
          <div className="privacy-policy-meta">
            <span>آخر تحديث: 9 يوليو 2026</span>
            <span>نسخة السياسة: 1.0</span>
          </div>
        </div>
      </section>

      <div className="privacy-policy-container privacy-policy-layout">
        <aside className="privacy-policy-nav" aria-label="محتويات سياسة الخصوصية">
          <h2>المحتويات</h2>
          <nav>
            <a href="#scope">نطاق السياسة</a>
            <a href="#data">البيانات التي نجمعها</a>
            <a href="#usage">كيف نستخدم البيانات</a>
            <a href="#sharing">مشاركة البيانات</a>
            <a href="#payments">المدفوعات</a>
            <a href="#location">الموقع الجغرافي</a>
            <a href="#retention">الاحتفاظ والحماية</a>
            <a href="#rights">حقوقك وحذف الحساب</a>
            <a href="#children">خصوصية الأطفال</a>
            <a href="#contact">التواصل معنا</a>
          </nav>
        </aside>

        <article className="privacy-policy-content">
          <section id="scope" className="privacy-policy-section">
            <span className="privacy-policy-section__number">01</span>
            <h2>نطاق هذه السياسة</h2>
            <p>
              تنطبق هذه السياسة على تطبيق <strong>صالون ملكات</strong>، والموقع
              الإلكتروني، وصفحات الحجز والدفع، وأي خدمة رقمية مرتبطة بها نديرها نحن.
              باستخدامك للخدمة فإنك تقر بقراءة هذه السياسة وفهمها.
            </p>
          </section>

          <section id="data" className="privacy-policy-section">
            <span className="privacy-policy-section__number">02</span>
            <h2>البيانات التي نجمعها</h2>
            <p>قد نجمع البيانات التالية بحسب الميزة التي تستخدمها:</p>
            <div className="privacy-policy-grid">
              <div className="privacy-policy-card">
                <h3>بيانات الحساب والتواصل</h3>
                <p>
                  الاسم، رقم الهاتف، البريد الإلكتروني، معرّف الحساب، وبيانات تسجيل
                  الدخول اللازمة لإنشاء الحساب وتأمينه.
                </p>
              </div>
              <div className="privacy-policy-card">
                <h3>بيانات الحجز والخدمات</h3>
                <p>
                  الخدمة أو الباقة المختارة، الموظفة، التاريخ والوقت، حالة الحجز،
                  الملاحظات، الكوبونات، وعدد الجلسات المستخدمة أو المتبقية.
                </p>
              </div>
              <div className="privacy-policy-card">
                <h3>الصور والملفات الاختيارية</h3>
                <p>
                  الصور التي تختارين رفعها أثناء الحجز، مثل صورة الشعر لتقييم الخدمة.
                  لا يتم الوصول إلى صور جهازك إلا بعد اختيارك الصريح للملف.
                </p>
              </div>
              <div className="privacy-policy-card">
                <h3>بيانات تقنية</h3>
                <p>
                  نوع الجهاز والمتصفح، عنوان بروتوكول الإنترنت، سجلات الأخطاء، وبيانات
                  التخزين المحلي اللازمة لاستمرار الجلسة وتحسين الأمان والأداء.
                </p>
              </div>
              <div className="privacy-policy-card">
                <h3>بيانات الدفع</h3>
                <p>
                  قيمة العملية، حالتها، مرجع الدفع، وطريقة الدفع. لا نخزّن رقم البطاقة
                  الكامل أو رمزها السري داخل تطبيق صالون ملكات.
                </p>
              </div>
              <div className="privacy-policy-card">
                <h3>الإشعارات</h3>
                <p>
                  عند تفعيل إشعارات التطبيق قد يُحفظ رمز إشعار الجهاز لإرسال تحديثات
                  الحجز والتذكيرات. يمكنك تعطيل الإشعارات من إعدادات جهازك.
                </p>
              </div>
            </div>
          </section>

          <section id="usage" className="privacy-policy-section">
            <span className="privacy-policy-section__number">03</span>
            <h2>كيف نستخدم بياناتك</h2>
            <ul className="privacy-policy-list">
              <li>إنشاء حسابك والتحقق منه وإدارة تسجيل الدخول.</li>
              <li>تنفيذ الحجوزات وتأكيدها وتعديلها ومتابعة حالتها.</li>
              <li>إدارة الباقات والجلسات والعروض وبرامج الولاء.</li>
              <li>معالجة المدفوعات والتحقق من حالتها ومنع الاحتيال.</li>
              <li>التواصل بشأن الموعد أو التغييرات أو طلبات الدعم.</li>
              <li>حماية الحسابات والتحقيق في الأعطال أو الاستخدام غير المصرح به.</li>
              <li>تحسين تجربة التطبيق والخدمات مع استخدام بيانات مجمعة قدر الإمكان.</li>
              <li>الامتثال للالتزامات النظامية والمحاسبية وحفظ السجلات المطلوبة.</li>
            </ul>
          </section>

          <section id="sharing" className="privacy-policy-section">
            <span className="privacy-policy-section__number">04</span>
            <h2>مشاركة البيانات ومقدمو الخدمات</h2>
            <p>
              لا نبيع بياناتك الشخصية. قد نشارك الحد الأدنى اللازم من البيانات مع
              مقدمي خدمات موثوقين لتشغيل التطبيق، ومنهم:
            </p>
            <ul className="privacy-policy-list">
              <li>
                <strong>Google Firebase:</strong> للمصادقة وقواعد البيانات وتخزين بعض
                الصور والملفات وتشغيل الخدمات الخلفية.
              </li>
              <li>
                <strong>Moyasar:</strong> لمعالجة المدفوعات الإلكترونية والتحقق من
                حالة العملية.
              </li>
              <li>
                <strong>Vercel وCloudflare:</strong> لاستضافة الواجهة والخدمات وتشغيل
                بعض الوظائف وحماية الاتصال وتخزين الملفات عند الحاجة.
              </li>
              <li>
                الجهات المختصة عندما يكون الإفصاح مطلوبًا بموجب نظام أو أمر قانوني
                نافذ، أو لحماية الحقوق والسلامة ومنع الاحتيال.
              </li>
            </ul>
            <p>
              قد تتم معالجة بعض البيانات على خوادم خارج بلدك بحسب مواقع مراكز بيانات
              مقدمي الخدمات، مع تطبيق الضمانات الأمنية والتعاقدية المناسبة.
            </p>
          </section>

          <section id="payments" className="privacy-policy-section">
            <span className="privacy-policy-section__number">05</span>
            <h2>المدفوعات الإلكترونية</h2>
            <p>
              عند اختيار الدفع الإلكتروني يتم إدخال بيانات البطاقة في صفحة أو مكوّن
              تابع لمقدم خدمة الدفع. يحتفظ صالون ملكات بمرجع العملية وقيمتها وحالتها
              فقط بالقدر اللازم لتأكيد الحجز والمحاسبة وخدمة العملاء. تخضع معالجة بيانات
              البطاقة أيضًا لسياسة الخصوصية والأمان الخاصة بمقدم الدفع.
            </p>
          </section>

          <section id="location" className="privacy-policy-section">
            <span className="privacy-policy-section__number">06</span>
            <h2>الموقع الجغرافي</h2>
            <p>
              إصدار العميل من تطبيق صالون ملكات لا يحتاج إلى موقعك الجغرافي الدقيق
              لإجراء الحجز. إذا استُخدم إصدار مخصص للموظفات يتضمن نظام الحضور، فقد يتم
              طلب الموقع بإذن صريح عند تنفيذ البصمة للتحقق من وجود الموظفة داخل نطاق
              العمل. لا يُستخدم الموقع لهذا الغرض في الخلفية بشكل مستمر.
            </p>
          </section>

          <section id="retention" className="privacy-policy-section">
            <span className="privacy-policy-section__number">07</span>
            <h2>مدة الاحتفاظ بالبيانات وحمايتها</h2>
            <p>
              نحتفظ بالبيانات طوال مدة نشاط الحساب أو بالقدر اللازم لتنفيذ الخدمة،
              ومعالجة النزاعات، والوفاء بالمتطلبات النظامية والمحاسبية. بعد انتهاء الحاجة
              إليها تُحذف أو تُحوّل إلى بيانات غير مرتبطة بهوية المستخدم متى كان ذلك
              ممكنًا.
            </p>
            <p>
              نستخدم وسائل حماية تقنية وتنظيمية معقولة، مثل الاتصال المشفر، المصادقة،
              تقييد الصلاحيات، ومراقبة الأخطاء. ومع ذلك لا توجد وسيلة نقل أو تخزين
              إلكتروني تضمن أمانًا مطلقًا بنسبة 100٪.
            </p>
          </section>

          <section id="rights" className="privacy-policy-section">
            <span className="privacy-policy-section__number">08</span>
            <h2>حقوقك وتصحيح البيانات وحذف الحساب</h2>
            <p>
              يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها، أو سحب الموافقة على
              معالجة اختيارية، وذلك مع مراعاة أي التزام نظامي يوجب الاحتفاظ ببعض
              السجلات.
            </p>
            <div className="privacy-policy-delete-box">
              <h3>طريقة طلب حذف الحساب والبيانات</h3>
              <ol>
                <li>
                  أرسل رسالة من البريد المرتبط بالحساب إلى
                  <a href={`mailto:${SUPPORT_EMAIL}`}> {SUPPORT_EMAIL}</a>.
                </li>
                <li>اكتب في عنوان الرسالة: «طلب حذف حساب صالون ملكات».</li>
                <li>اذكر رقم الهاتف أو البريد المستخدم في الحساب للتحقق من الملكية.</li>
                <li>
                  بعد التحقق نعالج الطلب خلال مدة معقولة، ونبلغك بما حُذف وما يلزم
                  الاحتفاظ به نظاميًا وسبب ذلك.
                </li>
              </ol>
              <a
                className="privacy-policy-action"
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                  "طلب حذف حساب صالون ملكات"
                )}`}
              >
                إرسال طلب حذف الحساب
              </a>
            </div>
          </section>

          <section id="children" className="privacy-policy-section">
            <span className="privacy-policy-section__number">09</span>
            <h2>خصوصية الأطفال</h2>
            <p>
              التطبيق غير موجه للأطفال دون 13 عامًا، ولا نجمع عن علم بيانات شخصية من
              طفل دون هذا العمر. عند اكتشاف ذلك سنتخذ الخطوات المناسبة لحذف البيانات.
              يجب على ولي الأمر التواصل معنا إذا اعتقد أن طفلًا زودنا ببياناته.
            </p>
          </section>

          <section className="privacy-policy-section">
            <span className="privacy-policy-section__number">10</span>
            <h2>تحديثات هذه السياسة</h2>
            <p>
              قد نحدّث هذه السياسة عند تطوير الميزات أو تغير المتطلبات النظامية. سنعرض
              تاريخ آخر تحديث في أعلى الصفحة، وقد نرسل إشعارًا عند وجود تغيير جوهري.
              استمرار استخدام الخدمة بعد سريان التحديث يعني الاطلاع على النسخة المحدثة.
            </p>
          </section>

          <section id="contact" className="privacy-policy-section privacy-policy-contact">
            <span className="privacy-policy-section__number">11</span>
            <h2>التواصل معنا</h2>
            <p>
              للاستفسارات المتعلقة بالخصوصية أو طلبات الوصول والتصحيح والحذف، تواصل
              معنا عبر البريد الإلكتروني:
            </p>
            <a className="privacy-policy-email" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            <div className="privacy-policy-back">
              <Link to="/">العودة إلى الصفحة الرئيسية</Link>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
};

export default PrivacyPolicy;
