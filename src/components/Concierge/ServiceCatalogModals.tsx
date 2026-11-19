import React, { useEffect, useState } from 'react';
import { Pencil, Tag, Trash2 } from 'lucide-react';
import { ModalSystem } from '../Shared/ModalSystem';
import { conciergeFetch } from './conciergeApi';
import { useERP } from '../../context/ERPContext';

/**
 * Shared add/edit/delete dialogs for the concierge service catalogs
 * (`guest_services` rows — experiences, tours, tickets, shopping,
 * itineraries, bell-desk, parcel, VIP, and reminder service types).
 */

export interface ServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  available: boolean;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 transition focus:border-[var(--color-accent-operations)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-operations)]/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const labelClass = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300';

const parseJson = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected response (${response.status})`);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
};

// ── Add / Edit modal ─────────────────────────────────────────────────────────

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Fixed guest_services category for the module (e.g. 'tour', 'luggage'). */
  category: string;
  /** Human label for titles, e.g. 'tour', 'service type'. */
  itemLabel?: string;
  /** null → create mode, item → edit mode. */
  item: ServiceCatalogItem | null;
  /** Hide the price field for complimentary service types. */
  showPrice?: boolean;
}

export const ServiceItemModal: React.FC<EditModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  category,
  itemLabel = 'service',
  item,
  showPrice = true,
}) => {
  const { addNotification } = useERP();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', price: 0, available: true });

  useEffect(() => {
    if (isOpen) {
      setForm({
        name: item?.name ?? '',
        description: item?.description ?? '',
        price: Number(item?.price ?? 0),
        available: item?.available ?? true,
      });
      setFormError(null);
    }
  }, [isOpen, item]);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required');
      return;
    }
    try {
      setSubmitting(true);
      setFormError(null);
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category,
        price: Number(form.price) || 0,
        available: form.available,
      };
      const response = await conciergeFetch(
        item ? `/api/concierge/services/${item.id}` : '/api/concierge/services',
        { method: item ? 'PUT' : 'POST', json: true, body: JSON.stringify(body) }
      );
      await parseJson(response);
      addNotification(item ? `${itemLabel} updated` : `${itemLabel} added`, 'success', 'Concierge');
      onSaved();
      onClose();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalSystem
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleSubmit}
      title={item ? `Edit ${itemLabel}` : `Add ${itemLabel}`}
      subtitle={item ? `Update "${item.name}"` : `New ${itemLabel} — available to guests immediately`}
      icon={<Tag size={18} className="text-[var(--color-accent-operations)]" />}
      variant="form"
      size="sm"
      loading={submitting}
      confirmLabel={item ? 'Save Changes' : `Add ${itemLabel}`}
      confirmColor="slate"
    >
      <div className="space-y-4">
        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {formError}
          </div>
        )}
        <div>
          <label className={labelClass}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
            placeholder={`${itemLabel} name`}
            autoFocus
          />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={`${inputClass} min-h-[72px] resize-y`}
            placeholder="Shown to staff on the catalog card"
          />
        </div>
        {showPrice && (
          <div>
            <label className={labelClass}>Price (USD)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
        )}
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
          <span className="text-sm text-slate-700 dark:text-slate-200">Available</span>
          <button
            type="button"
            onClick={() => setForm({ ...form, available: !form.available })}
            className={`relative h-6 w-11 rounded-full transition ${
              form.available ? 'bg-[var(--color-accent-operations)]' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                form.available ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>
      </div>
    </ModalSystem>
  );
};

// ── Delete confirmation ──────────────────────────────────────────────────────

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
  item: ServiceCatalogItem | null;
  itemLabel?: string;
}

export const DeleteServiceModal: React.FC<DeleteModalProps> = ({
  isOpen,
  onClose,
  onDeleted,
  item,
  itemLabel = 'service',
}) => {
  const { addNotification } = useERP();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!item) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      const response = await conciergeFetch(`/api/concierge/services/${item.id}`, {
        method: 'DELETE',
        json: true,
      });
      await parseJson(response);
      addNotification(`${itemLabel} removed`, 'success', 'Concierge');
      onDeleted();
      onClose();
    } catch (e: any) {
      setDeleteError(e?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalSystem
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleDelete}
      title={`Remove ${itemLabel}`}
      subtitle={`"${item?.name}" will be removed from the catalog. Existing guest requests are not affected.`}
      variant="confirm"
      size="sm"
      loading={deleting}
      confirmLabel="Remove"
      confirmColor="rose"
    >
      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {deleteError}
        </div>
      )}
    </ModalSystem>
  );
};

// ── Per-card edit/delete icon buttons ────────────────────────────────────────

interface ItemActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

export const ServiceItemActions: React.FC<ItemActionsProps> = ({ onEdit, onDelete }) => (
  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEdit(); }}
      title="Edit"
      className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      <Pencil size={14} />
    </button>
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      title="Remove"
      className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
    >
      <Trash2 size={14} />
    </button>
  </div>
);
