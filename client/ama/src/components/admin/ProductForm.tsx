// src/components/admin/ProductForm.tsx
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import React, { useState, useMemo } from "react";
import { useTranslation } from "@/i18n";
import { emptyLocalized, ensureLocalizedObject } from "@/lib/localized";
import type { SupportedLocale } from "@/context/LanguageContext";

interface ProductFormProps {
  newProduct: any;
  setNewProduct: React.Dispatch<React.SetStateAction<any>>; // ✅ تصحيح النوع
  productsState: any[];
  setProductsState: React.Dispatch<React.SetStateAction<any[]>>; // ✅ تصحيح النوع
  token: string;
  onSuccess?: () => void; // لإعادة الجلب بعد النجاح (اختياري)
}

const ProductForm: React.FC<ProductFormProps> = ({
  newProduct,
  setNewProduct,
  productsState,
  setProductsState,
  token,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [newImage, setNewImage] = useState("");

  const mainCategories = useMemo(
    () =>
      [...new Set(productsState.map((p) => p.mainCategory))].filter(Boolean),
    [productsState]
  );

  const uniqueSubCategories = useMemo(() => {
    const list = productsState
      .filter((p) => p.mainCategory === newProduct.mainCategory)
      .map((p) => p.subCategory)
      .filter(Boolean);
    return [...new Set(list)];
  }, [productsState, newProduct.mainCategory]);

  // خيارات نوع الملكية
  const ownershipOptions = ["ours", "local"] as const;

  // ✅ خيارات الأولوية
  const priorityOptions = ["A", "B", "C"] as const;

  const languages: { code: SupportedLocale; label: string }[] = [
    { code: "ar", label: t("admin.languages.ar") },
    { code: "he", label: t("admin.languages.he") },
  ];

  const nameState = ensureLocalizedObject(newProduct.name, { trim: false });
  const descriptionState = ensureLocalizedObject(newProduct.description, {
    trim: false,
  });

  // إضافة صورة
  const handleAddImage = () => {
    if (newImage.trim()) {
      setNewProduct((prev: any) => ({
        ...prev,
        images: [...(prev.images || []), newImage.trim()],
      }));
      setNewImage("");
    }
  };

  // حذف عنصر من مصفوفة
  const handleRemoveItem = (index: number) => {
    setNewProduct((prev: any) => {
      const updated = [...(prev.images || [])];
      updated.splice(index, 1);
      return { ...prev, images: updated };
    });
  };

  // إرسال المنتج (يتضمن ownershipType + priority)
  const handleSubmit = async () => {
    try {
      const ownershipType = ["ours", "local"].includes(
        String(newProduct.ownershipType)
      )
        ? String(newProduct.ownershipType)
        : "ours";

      const priority = ["A", "B", "C"].includes(String(newProduct.priority))
        ? String(newProduct.priority)
        : "C";

      const normalizedName = ensureLocalizedObject(newProduct.name, {
        trim: false,
      });
      const normalizedDescription = ensureLocalizedObject(
        newProduct.description,
        { trim: false }
      );
      const sanitizedName = {
        ar: normalizedName.ar.trim(),
        he: normalizedName.he.trim(),
      };
      const sanitizedDescription = {
        ar: normalizedDescription.ar.trim(),
        he: normalizedDescription.he.trim(),
      };

      const payload: Record<string, unknown> = {
        name: sanitizedName,
        mainCategory: newProduct.mainCategory?.trim(),
        subCategory: newProduct.subCategory?.trim(),
        images: Array.isArray(newProduct.images) ? newProduct.images : [],
        ownershipType,
        priority,
      };

      if (sanitizedDescription.ar || sanitizedDescription.he) {
        payload.description = sanitizedDescription;
      }

      const res = await api.post("/products", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (onSuccess) {
        onSuccess();
      } else {
        setProductsState((prev) => [
          ...prev,
          {
            ...res.data,
            name: ensureLocalizedObject(res.data.name),
            description: ensureLocalizedObject(res.data.description),
            price: 0,
            quantity: 0,
          },
        ]);
      }

      setNewProduct({
        name: { ...emptyLocalized },
        mainCategory: "",
        subCategory: "",
        description: { ...emptyLocalized },
        images: [],
        ownershipType,
        priority,
      });
    } catch (err) {
      console.error("❌ Error adding product", err);
      alert(t("admin.productForm.alerts.createFailed"));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("admin.productForm.title")}</DialogTitle>
        <DialogDescription>{t("admin.productForm.subtitle")}</DialogDescription>
      </DialogHeader>

      <div className="max-h-[70vh] overflow-y-auto grid gap-4 py-4 text-right">
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t("common.labels.name")}</span>
          <div className="grid gap-3">
            {languages.map(({ code, label }) => (
              <div key={`name-${code}`} className="grid gap-1 text-right">
                <label className="text-xs text-muted-foreground">{label}</label>
                <Input
                  placeholder={t(
                    code === "ar"
                      ? "admin.productForm.placeholders.nameAr"
                      : "admin.productForm.placeholders.nameHe"
                  )}
                  value={nameState[code]}
                  onChange={(e) =>
                    setNewProduct((prev: any) => ({
                      ...prev,
                      name: {
                        ...ensureLocalizedObject(prev.name, { trim: false }),
                        [code]: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <Input
          list="main-categories"
          placeholder={t("admin.productForm.placeholders.mainCategory")}
          value={newProduct.mainCategory ?? ""}
          onChange={(e) =>
            setNewProduct((prev: any) => ({
              ...prev,
              mainCategory: e.target.value,
            }))
          }
        />
        <datalist id="main-categories">
          {mainCategories.map((cat, idx) => (
            <option key={idx} value={cat} />
          ))}
        </datalist>

        <Input
          list="sub-categories"
          placeholder={t("admin.productForm.placeholders.subCategory")}
          value={newProduct.subCategory ?? ""}
          onChange={(e) =>
            setNewProduct((prev: any) => ({
              ...prev,
              subCategory: e.target.value,
            }))
          }
        />
        <datalist id="sub-categories">
          {uniqueSubCategories.map((sub, idx) => (
            <option key={idx} value={sub} />
          ))}
        </datalist>

        {/* نوع الملكية */}
        <div className="grid gap-2">
          <label className="text-sm font-medium">
            {t("admin.productForm.labels.ownership")}
          </label>
          <select
            className="border rounded-md p-2 bg-background"
            value={newProduct.ownershipType ?? "ours"}
            onChange={(e) =>
              setNewProduct((prev: any) => ({
                ...prev,
                ownershipType: e.target.value,
              }))
            }
          >
            {ownershipOptions.map((opt) => (
              <option key={opt} value={opt}>
                {t(`admin.common.ownership.${opt}` as const)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("admin.productForm.helpers.ownership")}
          </p>
        </div>

        {/* ✅ الأولوية */}
        <div className="grid gap-2">
          <label className="text-sm font-medium">
            {t("admin.productForm.labels.priority")}
          </label>
          <select
            className="border rounded-md p-2 bg-background"
            value={newProduct.priority ?? "C"}
            onChange={(e) =>
              setNewProduct((prev: any) => ({
                ...prev,
                priority: e.target.value,
              }))
            }
          >
            {priorityOptions.map((opt) => (
              <option key={opt} value={opt}>
                {t(`admin.productForm.priorityOptions.${opt}` as const)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("admin.productForm.helpers.priority")}
          </p>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">
            {t("admin.productForm.placeholders.description")}
          </span>
          <div className="grid gap-3">
            {languages.map(({ code, label }) => (
              <div key={`desc-${code}`} className="grid gap-1 text-right">
                <label className="text-xs text-muted-foreground">{label}</label>
                <Textarea
                  placeholder={t(
                    code === "ar"
                      ? "admin.productForm.placeholders.descriptionAr"
                      : "admin.productForm.placeholders.descriptionHe"
                  )}
                  value={descriptionState[code]}
                  onChange={(e) =>
                    setNewProduct((prev: any) => ({
                      ...prev,
                      description: {
                        ...ensureLocalizedObject(prev.description, {
                          trim: false,
                        }),
                        [code]: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* صور */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder={t("admin.productForm.placeholders.image")}
              value={newImage}
              onChange={(e) => setNewImage(e.target.value)}
            />
            <Button type="button" onClick={handleAddImage}>
              {t("common.actions.add")}
            </Button>
          </div>
          <ul className="text-sm space-y-1">
            {(newProduct.images || []).map((img: string, idx: number) => (
              <li key={idx} className="flex justify-between items-center">
                <span className="truncate max-w-xs">{img}</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRemoveItem(idx)}
                >
                  {t("common.actions.delete")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={handleSubmit}>
          {t("admin.productForm.actions.save")}
        </Button>
      </DialogFooter>
    </>
  );
};

export default ProductForm;
