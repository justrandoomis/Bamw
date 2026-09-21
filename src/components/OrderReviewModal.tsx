import type { Order } from "@/lib/types";
import OrderReviewSheet from "@/components/reviews/OrderReviewSheet";

/**
 * The order chat's entry into the review.
 *
 * It used to be the review: one product picked from the order, stars, a
 * comment, and a coupon handed over the moment it was submitted. All of that
 * moved into {@link OrderReviewSheet}, where the code has to be earned — one
 * review for the whole order, an Instagram comment as proof, and an admin who
 * approves it.
 *
 * Kept as a component rather than folded into the caller so the chat does not
 * need to know the order's id is all the sheet wants.
 */
interface OrderReviewModalProps {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function OrderReviewModal({
  order,
  isOpen,
  onClose,
  onSubmitted,
}: OrderReviewModalProps) {
  return (
    <OrderReviewSheet
      orderId={String(order.id ?? "")}
      isOpen={isOpen}
      onClose={onClose}
      {...(onSubmitted ? { onSubmitted } : {})}
    />
  );
}
