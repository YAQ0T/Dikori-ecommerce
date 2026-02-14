// src/components/admin/OrderTable.tsx
import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import OrderStatusButtons from "./OrderStatusButtons";
import { useTranslation } from "@/i18n";
import { getLocalizedText } from "@/lib/localized";
import { useLanguage } from "@/context/LanguageContext";

type OrderStatus =
  | "waiting_confirmation"
  | "pending"
  | "on_the_way"
  | "delivered"
  | "cancelled";

interface OrderTableProps {
  orders: any[];
  filter: string;
  paymentMethodFilter: "all" | "card" | "cod" | "bank_transfer";
  updateStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  setSelectedOrder: (order: any) => void;
}

const useStatusHelpers = () => {
  const { t } = useTranslation();
  const statusLabel = (s: string) =>
    t(`admin.orders.status.${s}` as const, { defaultValue: s || "-" });
  const payMethodLabel = (m: string) => {
    if (m === "card") return t("admin.orders.paymentMethods.card");
    if (m === "cod") return t("admin.orders.paymentMethods.cod");
    if (m === "bank_transfer") {
      return t("admin.orders.paymentMethods.bank_transfer", {
        defaultValue: "🏦 حوالة بنكية",
      });
    }
    return m || "-";
  };
  const payStatusLabel = (s: string) => {
    if (s === "paid") return t("admin.orders.paymentStatus.paid");
    if (s === "failed") return t("admin.orders.paymentStatus.failed");
    return t("admin.orders.paymentStatus.unpaid");
  };
  const bankTransferStatusLabel = (s: string) =>
    t(`admin.orders.bankTransferStatus.${s}` as const, { defaultValue: s || "-" });

  return { statusLabel, payMethodLabel, payStatusLabel, bankTransferStatusLabel, t };
};

const currency = (n: number) => `₪${Number(n || 0).toFixed(2)}`;

const useItemRenderer = () => {
  const { t } = useTranslation();
  const { locale } = useLanguage();
  const renderItemsSummary = (items: any[] = [], notes: string | undefined) => {
    if (!items.length) return t("common.none");
    return (
      <div className="space-y-1">
        {items.map((it, i) => {
          const nameText =
            getLocalizedText(it?.name, locale) ||
            it?.productName ||
            t("admin.orders.fallbacks.product");
          const color = it?.color || it?.selectedColor;
          const measure = it?.measure || it?.selectedMeasure;
          const unit = it?.measureUnit || it?.selectedMeasureUnit;
          const qty = it?.quantity ?? 1;
          return (
            <div key={i} className="text-sm">
              <span className="font-medium">{nameText}</span>{" "}
              <span className="text-gray-500">
                {color
                  ? `| ${t("admin.orders.itemFields.color", { value: color })} `
                  : ""}
                {measure
                  ? `| ${t("admin.orders.itemFields.measure", {
                      value: measure,
                      unit: unit || "",
                    })} `
                  : ""}
                | {t("admin.orders.itemFields.quantity", { value: qty })}
              </span>
            </div>
          );
        })}
        {notes && (
          <div className="mt-4">
            <strong>{t("admin.orders.notesLabel")}:</strong> {notes}
          </div>
        )}
      </div>
    );
  };
  return { renderItemsSummary };
};
const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  filter,
  paymentMethodFilter,
  updateStatus,
  setSelectedOrder,
}) => {
  const {
    statusLabel,
    payMethodLabel,
    payStatusLabel,
    bankTransferStatusLabel,
    t,
  } = useStatusHelpers();
  const { renderItemsSummary } = useItemRenderer();
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        const statusMatch = filter === "all" ? true : order.status === filter;
        const paymentMethodMatch =
          paymentMethodFilter === "all"
            ? true
            : order.paymentMethod === paymentMethodFilter;
        return statusMatch && paymentMethodMatch;
      }),
    [filter, paymentMethodFilter, orders]
  );

  if (orders.length === 0)
    return <p className="text-gray-600">{t("admin.orders.empty")}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right border">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-4 py-2">#</th>
            <th className="border px-4 py-2">{t("common.labels.name")}</th>
            <th className="border px-4 py-2">{t("common.labels.phone")}</th>
            <th className="border px-4 py-2">{t("common.labels.address")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.items")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.subtotal")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.discount")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.total")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.paymentMethod")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.paymentStatus")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.status")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.itemCount")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.updateStatus")}</th>
            <th className="border px-4 py-2">{t("admin.orders.table.createdAt")}</th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.map((order, idx) => {
            const discountAmount =
              Number(order?.discount?.amount || 0) > 0 &&
              order?.discount?.applied
                ? order.discount.amount
                : 0;

            return (
              <tr key={order._id}>
                <td className="border px-4 py-2">
                  <Button
                    variant="link"
                    onClick={() => setSelectedOrder(order)}
                    className="text-blue-600 underline p-0"
                  >
                    {idx + 1}
                  </Button>
                </td>
                <td className="border px-4 py-2">{order?.user?.name || "-"}</td>
                <td className="border px-4 py-2">
                  {order?.user?.phone || "-"}
                </td>
                <td className="border px-4 py-2">{order?.address || "-"}</td>
                <td className="border px-4 py-2">
                  {renderItemsSummary(order?.items, order?.notes)}
                </td>
                <td className="border px-4 py-2">
                  {currency(order?.subtotal ?? 0)}
                </td>
                <td className="border px-4 py-2">
                  {discountAmount ? `-${currency(discountAmount)}` : "—"}
                </td>
                <td className="border px-4 py-2 font-semibold">
                  {currency(order?.total)}
                </td>
                <td className="border px-4 py-2">
                  {payMethodLabel(order?.paymentMethod)}
                </td>
                <td className="border px-4 py-2">
                  <div className="space-y-1">
                    <div>{payStatusLabel(order?.paymentStatus)}</div>
                    {order?.paymentMethod === "bank_transfer" &&
                      order?.bankTransferStatus && (
                        <div className="text-xs text-blue-700">
                          {bankTransferStatusLabel(order.bankTransferStatus)}
                        </div>
                      )}
                    {order?.paymentStatusNote && (
                      <div className="text-xs text-muted-foreground">
                        {order.paymentStatusNote}
                      </div>
                    )}
                  </div>
                </td>
                <td className="border px-4 py-2">
                  {statusLabel(order?.status)}
                </td>
                <td className="border px-4 py-2">
                  {order?.items?.length || 0}
                </td>
                <td className="border px-4 py-2">
                  <OrderStatusButtons
                    orderId={order._id}
                    updateStatus={updateStatus}
                  />
                </td>
                <td className="border px-4 py-2">
                  {order?.createdAt
                    ? new Date(order.createdAt).toLocaleDateString()
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default OrderTable;
