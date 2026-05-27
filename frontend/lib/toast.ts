/**
 * Module-level toast controller.
 *
 * Delegates to the React-managed controller registered by <ToastProvider>.
 * Safe to call from anywhere — outside React components, in API helpers, etc.
 * If called before <ToastProvider> mounts (e.g. during SSR), the call is a
 * silent no-op.
 *
 * Usage:
 *   import { toast } from '@/lib/toast'
 *   toast.success('Saved!')
 *   toast.error('Something went wrong')
 *   toast.info('Deployment started')
 */
import { addToast } from '@/components/ui/toast'

export const toast = {
  success(msg: string): void {
    addToast(msg, 'success')
  },
  error(msg: string): void {
    addToast(msg, 'error')
  },
  info(msg: string): void {
    addToast(msg, 'info')
  },
}
