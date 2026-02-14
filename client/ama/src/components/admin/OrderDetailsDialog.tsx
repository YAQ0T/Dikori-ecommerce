import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import OrderDetailsContent from "@/components/common/OrderDetailsContent";
import { useTranslation } from "@/i18n";

interface OrderDetailsDialogProps {
  selectedOrder: any;
  setSelectedOrder: (order: any | null) => void;
  setOrders: (orders: any[]) => void;
  orders: any[];
  token: string;
}

const OrderDetailsDialog: React.FC<OrderDetailsDialogProps> = ({
  selectedOrder,
  setSelectedOrder,
  setOrders,
  orders,
  token,
}) => {
  const { t } = useTranslation();
  const [markingPaid, setMarkingPaid] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "unpaid" | "paid" | "failed"
  >("unpaid");
  const [bankTransferStatus, setBankTransferStatus] = useState<
    "pending_contact" | "instructions_sent" | "transfer_received" | "verified"
  >("pending_contact");
  const [paymentStatusNote, setPaymentStatusNote] = useState("");

  useEffect(() => {
    if (!selectedOrder) return;
    const nextPaymentStatus =
      selectedOrder.paymentStatus === "paid" || selectedOrder.paymentStatus === "failed"
        ? selectedOrder.paymentStatus
        : "unpaid";
    setPaymentStatus(nextPaymentStatus);

    const nextBankStatus =
      selectedOrder.bankTransferStatus === "instructions_sent" ||
      selectedOrder.bankTransferStatus === "transfer_received" ||
      selectedOrder.bankTransferStatus === "verified"
        ? selectedOrder.bankTransferStatus
        : "pending_contact";
    setBankTransferStatus(nextBankStatus);
    setPaymentStatusNote(selectedOrder.paymentStatusNote || "");
  }, [selectedOrder]);

  if (!selectedOrder) return null;

  const handleDelete = async () => {
    const confirmDelete = confirm(t("admin.orderDetails.confirmDelete"));
    if (!confirmDelete) return;

    try {
      await api.delete(`/orders/${selectedOrder._id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const updatedOrders = orders.filter((o) => o._id !== selectedOrder._id);
      setOrders(updatedOrders);
      setSelectedOrder(null);
    } catch (err) {
      console.error("❌ Error deleting order", err);
      alert(t("admin.orderDetails.alerts.deleteFailed"));
    }
  };

  const handleMarkPaid = async () => {
    if (!selectedOrder?.reference) {
      alert(t("admin.orderDetails.alerts.missingReference"));
      return;
    }
    if (!token) {
      alert(t("admin.orderDetails.alerts.missingToken"));
      return;
    }

    try {
      setMarkingPaid(true);
      const { data } = await api.patch(
        `/orders/by-reference/${encodeURIComponent(selectedOrder.reference)}/pay`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const patched = data?.order || data;
      if (patched && patched._id) {
        const merged = orders.map((o) =>
          o._id === patched._id ? { ...o, ...patched } : o
        );
        setOrders(merged);
        setSelectedOrder(patched);
      }

      alert(data?.message || t("admin.orderDetails.alerts.markPaidSuccess"));
    } catch (err: any) {
      const status = err?.response?.status;
      const resp = err?.response?.data;
      console.error("❌ Error marking order paid", status, resp || err);
      alert(
        resp?.message
          ? t("admin.orderDetails.alerts.markPaidFailedWithMessage", {
              message: resp.message,
            })
          : t("admin.orderDetails.alerts.markPaidFailed")
      );
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleSavePayment = async () => {
    if (!selectedOrder?._id || !token) return;

    try {
      setSavingPayment(true);
      const payload: Record<string, string> = {
        paymentStatus,
        paymentStatusNote: paymentStatusNote.trim(),
      };

      if (selectedOrder?.paymentMethod === "bank_transfer") {
        payload.bankTransferStatus = bankTransferStatus;
      }

      const { data } = await api.patch(
        `/orders/${selectedOrder._id}/payment`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const patched = data;
      if (patched && patched._id) {
        const merged = orders.map((o) =>
          o._id === patched._id ? { ...o, ...patched } : o
        );
        setOrders(merged);
        setSelectedOrder(patched);
      }

      alert(t("admin.orderDetails.payment.alerts.updateSuccess"));
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        t("admin.orderDetails.payment.alerts.updateFailed");
      alert(msg);
    } finally {
      setSavingPayment(false);
    }
  };

  return (
    <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.orderDetails.title")}</DialogTitle>
          <DialogDescription>
            {t("admin.orderDetails.description", {
              id: selectedOrder?._id,
            })}
          </DialogDescription>
        </DialogHeader>

        {/* يعرض: المنتجات مع اللون/المقاس/الكمية/السعر بناءً على المكوّن المشترك */}
        <OrderDetailsContent order={selectedOrder} />

        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="font-semibold">
            {t("admin.orderDetails.payment.title")}
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">
                {t("admin.orderDetails.payment.labels.paymentStatus")}
              </label>
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={paymentStatus}
                onChange={(e) =>
                  setPaymentStatus(
                    e.target.value as "unpaid" | "paid" | "failed"
                  )
                }
              >
                <option value="unpaid">
                  {t("admin.orderDetails.payment.status.unpaid")}
                </option>
                <option value="paid">
                  {t("admin.orderDetails.payment.status.paid")}
                </option>
                <option value="failed">
                  {t("admin.orderDetails.payment.status.failed")}
                </option>
              </select>
            </div>

            {selectedOrder?.paymentMethod === "bank_transfer" && (
              <div>
                <label className="mb-1 block text-sm">
                  {t("admin.orderDetails.payment.labels.bankTransferStatus")}
                </label>
                <select
                  className="w-full rounded border px-2 py-2 text-sm"
                  value={bankTransferStatus}
                  onChange={(e) =>
                    setBankTransferStatus(
                      e.target.value as
                        | "pending_contact"
                        | "instructions_sent"
                        | "transfer_received"
                        | "verified"
                    )
                  }
                >
                  <option value="pending_contact">
                    {t("admin.orders.bankTransferStatus.pending_contact")}
                  </option>
                  <option value="instructions_sent">
                    {t("admin.orders.bankTransferStatus.instructions_sent")}
                  </option>
                  <option value="transfer_received">
                    {t("admin.orders.bankTransferStatus.transfer_received")}
                  </option>
                  <option value="verified">
                    {t("admin.orders.bankTransferStatus.verified")}
                  </option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm">
              {t("admin.orderDetails.payment.labels.note")}
            </label>
            <textarea
              value={paymentStatusNote}
              onChange={(e) => setPaymentStatusNote(e.target.value)}
              className="w-full rounded border px-2 py-2 text-sm"
              rows={3}
              placeholder={t("admin.orderDetails.payment.placeholders.note")}
            />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleSavePayment}
            disabled={savingPayment}
          >
            {savingPayment
              ? t("admin.orderDetails.payment.actions.saving")
              : t("admin.orderDetails.payment.actions.save")}
          </Button>
        </div>

        <div className="flex items-center justify-between mt-4">
          <Button size="sm" variant="destructive" onClick={handleDelete}>
            {t("admin.orderDetails.actions.delete")}
          </Button>
          <DialogFooter className="flex gap-2">
            {selectedOrder?.reference &&
              selectedOrder?.paymentStatus !== "paid" && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleMarkPaid}
                  disabled={markingPaid}
                >
                  {markingPaid
                    ? t("admin.orderDetails.actions.marking")
                    : t("admin.orderDetails.actions.markPaid")}
                </Button>
              )}
            <Button onClick={() => setSelectedOrder(null)}>
              {t("common.actions.close")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OrderDetailsDialog;
