import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import PageLoader from "@/components/common/PageLoader";
import SiteAdPopup from "@/components/common/SiteAdPopup";

const Home = lazy(() => import("@/pages/Home"));
const Products = lazy(() => import("./pages/Products"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Cart = lazy(() => import("./pages/Cart"));
const Account = lazy(() => import("./pages/Account"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ProductDetails = lazy(() => import("@/pages/ProductDetails"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const Favorites = lazy(() => import("./pages/Favorites"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const UserOrderDetails = lazy(() => import("./pages/UserOrderDetails"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const ReturnsPolicy = lazy(() => import("./pages/ReturnsPolicy"));
const AdminHomeCollections = lazy(() => import("./pages/AdminHomeCollections"));
const VerifyPhone = lazy(() => import("./pages/VerifyPhone"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

function App() {
  return (
    <>
      <SiteAdPopup />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/account" element={<Account />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* ✅ صفحة توثيق الجوال (المسار القديم) */}
          <Route path="/verify" element={<VerifyPhone />} />
          {/* ✅ إضافة المسار الجديد المستخدم في بعض التحويلات */}
          <Route path="/verify-phone" element={<VerifyPhone />} />

          <Route path="/products/:id" element={<ProductDetails />} />

          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/returnes" element={<ReturnsPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/my-orders/:orderId" element={<UserOrderDetails />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route
            path="/admin/home-collections"
            element={<AdminHomeCollections />}
          />

          {/* ✅ إدارة كلمة المرور */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
