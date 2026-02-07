// src/pages/UserOrderDetails.tsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import OrderDetailsContent from "@/components/common/OrderDetailsContent";

const UserOrderDetails: React.FC = () => {
  const { user, token } = useAuth();
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    if (!user || !token) {
      navigate("/login");
      return;
    }

    api
      .get(`/orders/user/${user._id}/order/${orderId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((res) => setOrder(res.data))
      .catch((err) => {
        console.error("فشل في جلب تفاصيل الطلب", err);
        alert("لم يتم العثور على تفاصيل الطلب أو ليس لديك الصلاحية");
      });
  }, [orderId, user, token, navigate]);

  return (
    <>
      <Navbar />
      <main className="container mx-auto p-6 text-right">
        <h1 className="text-2xl font-bold mb-4">تفاصيل الطلب</h1>
        {order ? <OrderDetailsContent order={order} /> : <p>جارٍ التحميل...</p>}
      </main>
      <Footer />
    </>
  );
};

export default UserOrderDetails;
