import React, { useState } from "react";
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
  if (!selectedOrder) return null;

  const { t } = useTranslation();
  const [markingPaid, setMarkingPaid] = useState(false);

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

  return (
    <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
      <DialogContent>
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
