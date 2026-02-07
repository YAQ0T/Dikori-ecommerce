import { Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n";

const PageLoader = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">{t("app.loading")}</p>
    </div>
  );
};

export default PageLoader;
