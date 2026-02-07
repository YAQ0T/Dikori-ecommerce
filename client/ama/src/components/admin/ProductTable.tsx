// src/components/admin/ProductTable.tsx
import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import VariantManagerDialog from "@/components/admin/VariantManagerDialog";
import { useTranslation } from "@/i18n";
import { getLocalizedText } from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";

interface ProductTableProps {
  productsState: any[];
  setProductsState: React.Dispatch<React.SetStateAction<any[]>>; // ✅ تصحيح النوع
  productFilter: string;
  token: string;
  onEdit: (product: any) => void;
  onRefreshProducts?: () => void; // لإعادة تحميل المنتجات مع الإحصاءات بعد تغييرات المتغيرات
}

const badgeBase =
  "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium";
const badgeOurs = `${badgeBase} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300`;
const badgeLocal = `${badgeBase} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;

// شارة بسيطة لعرض الأولوية
function PriorityBadge({ value }: { value?: string }) {
  const { t } = useTranslation();
  const v = (value || "C").toUpperCase();
  const map: Record<string, string> = {
    A: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
    B: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    C: "bg-gray-100 text-gray-800 dark:bg-zinc-900/30 dark:text-gray-300",
  };
  const cls = `${badgeBase} ${map[v] || map.C}`;
  return (
    <span className={cls} title={t("admin.productTable.priorityTitle")}>
      {v}
    </span>
  );
}

function OwnershipBadge({ value }: { value?: string }) {
  const { t } = useTranslation();
  const v = (value || "ours").toLowerCase();
  if (v === "local")
    return (
      <span
        className={badgeLocal}
        title={t("admin.common.ownership.local")}
      >
        {t("admin.common.ownership.local")}
      </span>
    );
  return (
    <span className={badgeOurs} title={t("admin.common.ownership.ours")}>
      {t("admin.common.ownership.ours")}
    </span>
  );
}

const ProductTable: React.FC<ProductTableProps> = ({
  productsState,
  setProductsState,
  productFilter,
  token,
  onEdit,
  onRefreshProducts,
}) => {
  const { t } = useTranslation();
  const { locale } = useLanguage();
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleDelete = async (productId: string, productName: string) => {
    const confirmDelete = confirm(
      t("admin.productTable.confirmDelete", { name: productName })
    );
    if (!confirmDelete) return;

    try {
      await api.delete(`/products/${productId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProductsState((prev) => prev.filter((p) => p._id !== productId));
    } catch (err) {
      console.error("❌ Error deleting product", err);
      alert(t("admin.productTable.alerts.deleteFailed"));
    }
  };

  // ✅ تغيير أولوية المنتج (Inline)
  const handlePriorityChange = async (
    productId: string,
    newPriority: string
  ) => {
    const clean = ["A", "B", "C"].includes(newPriority) ? newPriority : "C";

    // تحديث متفائل
    setProductsState((prev) =>
      prev.map((p) => (p._id === productId ? { ...p, priority: clean } : p))
    );
    setSavingId(productId);

    try {
      await api.put(
        `/products/${productId}`,
        { priority: clean },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error("❌ Error updating priority", err);
      alert(t("admin.productTable.alerts.priorityFailed"));
      // في حالة الخطأ، يُفضّل إعادة الجلب إن كان متاحًا
      if (onRefreshProducts) onRefreshProducts();
    } finally {
      setSavingId(null);
    }
  };

  // فلترة حسب التصنيف كما كانت
  const list = useMemo(() => {
    const filtered = productsState.filter((product) => {
      if (productFilter === "all") return true;
      return (
        product.mainCategory === productFilter ||
        product.subCategory === productFilter
      );
    });

    // ترتيب بسيط (أحدث أولاً) إن كان createdAt موجود
    return [...filtered].sort((a, b) => {
      const ad = new Date(a.createdAt || 0).getTime();
      const bd = new Date(b.createdAt || 0).getTime();
      return bd - ad;
    });
  }, [productsState, productFilter]);

  // دوال مساعدة لعرض السعر/الكمية مع fallback
  const getDisplayPrice = (p: any) => {
    const v =
      typeof p?.minPrice === "number"
        ? p.minPrice
        : typeof p?.price === "number"
        ? p.price
        : 0;
    return `₪${v}`;
  };

  const getDisplayQuantity = (p: any) => {
    if (typeof p?.totalStock === "number") return p.totalStock;
    if (typeof p?.quantity === "number") return p.quantity;
    return 0;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right border">
        <thead className="bg-gray-100 dark:bg-zinc-900/50">
          <tr>
            <th className="border px-4 py-2">#</th>
            <th className="border px-4 py-2">{t("common.labels.name")}</th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.ownership")}
            </th>
            {/* ✅ عمود الأولوية */}
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.priority")}
            </th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.minPrice")}
            </th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.totalQuantity")}
            </th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.mainCategory")}
            </th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.subCategory")}
            </th>
            <th className="border px-4 py-2">
              {t("admin.productTable.headers.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((product, idx) => {
            const displayName =
              getLocalizedText(product.name, locale) || product._id;
            const previewImage =
              Array.isArray(product.images) && product.images[0]
                ? product.images[0]
                : undefined;
            return (
              <tr
                key={product._id}
                className="odd:bg-white even:bg-gray-50 dark:odd:bg-zinc-900 dark:even:bg-zinc-950"
              >
                <td className="border px-4 py-2 align-top">{idx + 1}</td>
                <td className="border px-4 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{displayName}</span>
                    {previewImage && (
                      <a
                        href={previewImage}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline truncate max-w-[220px]"
                        title={t("admin.productTable.previewImage")}
                      >
                        {t("admin.productTable.previewImage")}
                      </a>
                    )}
                  </div>
                </td>

                <td className="border px-4 py-2 align-top">
                  <OwnershipBadge value={product.ownershipType} />
                </td>

                {/* ✅ خلية التحكم بالأولوية */}
                <td className="border px-4 py-2 align-top">
                  <div className="flex items-center gap-2 justify-end">
                    <PriorityBadge value={product.priority} />
                    <select
                      className="border rounded-md p-1 text-sm bg-background"
                      value={(product.priority || "C").toUpperCase()}
                      onChange={(e) =>
                        handlePriorityChange(product._id, e.target.value)
                      }
                      disabled={savingId === product._id}
                      title={t("admin.productTable.changePriority")}
                    >
                      <option value="A">
                        {t("admin.productTable.priorityOptions.high")}
                      </option>
                      <option value="B">
                        {t("admin.productTable.priorityOptions.medium")}
                      </option>
                      <option value="C">
                        {t("admin.productTable.priorityOptions.normal")}
                      </option>
                    </select>
                  </div>
                </td>

                <td className="border px-4 py-2 align-top">
                  {getDisplayPrice(product)}
                </td>
                <td className="border px-4 py-2 align-top">
                  {getDisplayQuantity(product)}
                </td>
                <td className="border px-4 py-2 align-top">
                  {product.mainCategory}
                </td>
                <td className="border px-4 py-2 align-top">
                  {product.subCategory}
                </td>
                <td className="border px-4 py-2 align-top">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(product)}
                    >
                      {t("admin.productTable.actions.edit")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedProduct(product);
                        setManageOpen(true);
                      }}
                    >
                      {t("admin.productTable.actions.variants")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(product._id, displayName)}
                    >
                      {t("admin.productTable.actions.delete")}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td
                colSpan={9}
                className="border px-4 py-6 text-center text-gray-500"
              >
                {t("admin.productTable.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* مودال إدارة المتغيّرات */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="w-[95vw] sm:max-w-7xl max-h-[85vh] overflow-y-auto p-6">
          {selectedProduct && (
            <VariantManagerDialog
              product={selectedProduct}
              token={token}
              onClose={() => setManageOpen(false)}
              onChanged={onRefreshProducts}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductTable;
