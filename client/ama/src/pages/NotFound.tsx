import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { useTranslation } from "@/i18n";
import { useNavigate } from "react-router-dom";

const NotFound = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      <Navbar />
      <main className="container mx-auto px-4 py-16 text-right">
        <div className="surface-card p-8 md:p-12">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-3">
            {t("notFound.kicker")}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold mb-4">
            {t("notFound.title")}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mb-6">
            {t("notFound.description")}
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={() => navigate("/")}>{t("notFound.home")}</Button>
            <Button variant="outline" onClick={() => navigate("/products")}
            >
              {t("notFound.products")}
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default NotFound;
