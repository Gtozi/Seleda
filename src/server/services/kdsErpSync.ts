import { hasSupabaseAdminConfig, supabaseAdmin } from '../supabaseAdmin';

/**
 * ERP side-effects of a KDS ticket transition. Best-effort: never throws.
 * When the ticket belongs to a room-service order (fb_room_service_orders.order_id
 * == kds_orders.order_id), the in-house guest is notified through guest_notifications
 * so the guest portal feed reflects kitchen progress.
 */
export async function syncKdsTicketToErp(ticket: any, status: string): Promise<void> {
  if (!hasSupabaseAdminConfig || !supabaseAdmin || !ticket?.order_id) return;
  const label = status === 'in_progress' ? 'is being prepared'
    : status === 'ready' ? 'is ready and will be delivered shortly'
    : status === 'voided' ? 'could not be prepared — our team will contact you'
    : null;
  if (!label) return;
  try {
    const { data: rs } = await supabaseAdmin
      .from('fb_room_service_orders')
      .select('id, order_id, guest_id, reservation_id, property_id')
      .eq('order_id', ticket.order_id)
      .limit(1)
      .maybeSingle();
    if (!rs?.guest_id) return;
    await supabaseAdmin.from('guest_notifications').insert({
      property_id: rs.property_id || null,
      guest_id: rs.guest_id,
      reservation_id: rs.reservation_id || null,
      category: 'order',
      title: 'Room service update',
      message: `Your order ${rs.order_id || rs.id} ${label}.`,
    });
  } catch (e: any) {
    console.warn('KDS→ERP sync failed:', e?.message);
  }
}
