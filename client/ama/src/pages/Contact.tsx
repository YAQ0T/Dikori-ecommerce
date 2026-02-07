import React, { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const Contact: React.FC = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  useEffect(() => {
    console.log("Contact page loaded");
  }, []);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({ ...formData, [e.target.id]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);

    try {
      const res = await api.post("/contact", formData);
      if (res.status === 200) {
        console.log("✅ تم إرسال الرسالة بنجاح");
        setFeedback("✅ تم إرسال الرسالة بنجاح!");
        setFormData({ name: "", email: "", message: "" });
      }
    } catch (err) {
      console.error("❌ فشل في إرسال الرسالة", err);
      setFeedback("❌ حدث خطأ أثناء إرسال الرسالة");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-4 text-right">تواصل معنا</h1>
        <p className="dark:text-gray-200 text-lg mb-6 text-right text-gray-700">
          يسعدنا تواصلك معنا لأي استفسار أو طلب. يمكنك تعبئة النموذج أدناه أو
          الاتصال بنا مباشرة.
        </p>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 max-w-lg mx-auto text-right"
        >
          <div>
            <label htmlFor="name" className="block mb-1 font-medium">
              الاسم الكامل
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              placeholder="أدخل اسمك"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="block mb-1 font-medium">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@example.com"
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              required
            />
          </div>
          <div>
            <label htmlFor="message" className="block mb-1 font-medium">
              الرسالة
            </label>
            <textarea
              id="message"
              rows={4}
              value={formData.message}
              onChange={handleChange}
              placeholder="اكتب رسالتك هنا..."
              className="w-full border rounded px-3 py-2 focus:outline-none focus:ring focus:border-blue-300"
              required
            />
          </div>
          <div className="text-left">
            <Button type="submit" disabled={loading}>
              {loading ? "جاري الإرسال..." : "إرسال الرسالة"}
            </Button>
          </div>
          {feedback && (
            <p
              className={`text-sm mt-2 ${
                feedback.startsWith("✅") ? "text-green-600" : "text-red-600"
              }`}
            >
              {feedback}
            </p>
          )}
        </form>
      </main>
      <Footer />
    </>
  );
};

export default Contact;
