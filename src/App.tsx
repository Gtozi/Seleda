/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useERP } from './context/ERPContext';
import { AppProviders } from './context/AppProviders';
import LoginPage from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import CheckInPrintModal from './components/FrontDesk/CheckInPrintModal';
import GroupCheckInPrintModal from './components/FrontDesk/GroupCheckInPrintModal';
import { getVisibleAdminModules } from './components/Admin/adminModules';
const GuestPortal = lazy(() => import('./components/GuestPortal/GuestPortal'));
const PublicPortal = lazy(() => import('./components/PublicPortal/PublicPortal'));
const POSPortal = lazy(() => import('./components/POS/POSPortal'));
import POSLoginPage, { fetchPOSOutlets, buildPOSUser } from './components/POS/POSLoginPage';
const KitchenDisplayModule = lazy(() => import('./components/FoodBeverage/KitchenDisplayModule'));
const KDSInstanceManagement = lazy(() => import('./components/FoodBeverage/KDSInstanceManagement'));
import { SideNavigation } from './components/Shared/SideNavigation';
import { ErpLayout, ErpIndexRedirect } from './components/Shared/ErpLayout';
import { DepartmentRoute } from './components/Shared/DepartmentRoute';
import { DepartmentSwitcher } from './components/Shared/DepartmentSwitcher';
import { TenantSwitcher } from './components/Shared/TenantSwitcher';
import { SuperAdminPortal } from './components/Admin/SuperAdminPortal';
import { DEPARTMENT_BY_KEY, DEPARTMENT_BY_SEGMENT, getDefaultErpPath, getDeptAccentClass, type DepartmentKey } from './config/departments';
import { isTabEnabledByToggles } from './config/departmentTabs';
import { User } from './types/erp';
import { supabase } from './lib/supabase';
import { logout, verifySession } from './lib/auth';
import { getSubdomainInfo, redirectToAppropriateSubdomain } from './lib/subdomain';
import {
  LogOut,
  Users,
  Calendar,
  Lock,
  Settings,
  Moon,
  Sun,
  LayoutDashboard,
  FileBarChart,
  AlertCircle,
  Grid3x3,
  DoorOpen,
  Home,
  BedDouble,
  Crown,
  Key,
  Shield,
  FileText,
  MessageSquare,
  CreditCard,
  Car,
  Utensils,
  Wrench,
  Package,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Building2,
  ClipboardList,
  ClipboardCheck,
  Receipt,
  Wallet,
  PiggyBank,
  Banknote,
  Scale,
  Target,
  Boxes,
  Building,
  Landmark,
  Gavel,
  FolderOpen,
  CheckSquare,
  BarChart3,
  PieChart,
  ShieldAlert,
  BookOpen,
  Brain,
  Compass,
  Eye,
  Activity,
  Leaf,
  Trophy,
  LineChart,
  SlidersHorizontal,
  Moon as MoonIcon,
  Bell as BellIcon,
  SprayCan,
  Brush,
  Search,
  Truck,
  Wine,
  ChefHat,
  Store,
  HandPlatter,
  PartyPopper,
  Mail,
  Tag,
  Layers,
  Network,
  Briefcase,
  IdCard,
  UserPlus,
  UserCheck,
  CalendarDays,
  Clock,
  CalendarOff,
  Gift,
  GraduationCap,
  HeartPulse,
  Handshake,
  FolderArchive,
  Workflow,
  Fingerprint,
  Cctv,
  Footprints,
  Siren,
  Flame,
  AlertTriangle,
  LifeBuoy,
  HardHat,
  ShieldCheck,
  KeySquare,
  Route as RouteIcon,
  MapPin,
  Gauge,
  Fuel,
  HardDrive,
  HardDriveDownload,
  Plane,
  Bus,
  Star,
  Command,
  CheckCircle2,
  ArrowRightLeft,
  Heart,
  Award,
  Ticket,
  Megaphone,
  ListChecks,
  FileCheck,
  Sparkles,
  Dumbbell,
  ShoppingBag,
  UserMinus,
  CalendarPlus,
  FileWarning,
  type LucideIcon
} from 'lucide-react';

function POSLoginRoute({ onLoginSuccess }: { onLoginSuccess: (user: any) => void }) {
  return <POSLoginPage onLoginSuccess={onLoginSuccess} />;
}

function LoginRoute({ onLoginSuccess }: { onLoginSuccess: (user: User, forcePasswordChange?: boolean) => void }) {
  return <LoginPage onLoginSuccess={onLoginSuccess} />;
}

/** The booking engine now lives inside the public portal; keep old /booking links working. */
function BookingRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('section', 'booking');
  return <Navigate to={`/public-portal?${params}`} replace />;
}

function MasterHotelERP() {
  const location = useLocation();
  const navigate = useNavigate();
  const { 
    notifications, 
    markNotificationRead, 
    clearNotification, 
    currentSystemDate, 
    stats,
    currency,
    setCurrency,
    formatAmount,
    theme,
    toggleTheme,
    globalHotelSettings,
    refreshAllData,
    currentPropertyId,
    setCurrentPropertyId,
    properties
  } = useERP();

  // Subdomain detection
  const subdomainInfo = getSubdomainInfo();
  const isAdminSubdomain = subdomainInfo.isAdmin;
  const tenantCode = subdomainInfo.tenantCode;

  // User Authentication state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Redirect to appropriate subdomain based on user access
  React.useEffect(() => {
    if (sessionChecked && currentUser) {
      redirectToAppropriateSubdomain(currentUser);
    }
  }, [sessionChecked, currentUser]);

  // If on admin subdomain, redirect to /admin route (super admin portal)
  React.useEffect(() => {
    if (sessionChecked && currentUser && isAdminSubdomain && !location.pathname.startsWith('/admin')) {
      navigate('/admin', { replace: true });
    }
  }, [sessionChecked, currentUser, isAdminSubdomain, location.pathname, navigate]);

  // POS Authentication state
  const [posUser, setPosUser] = useState<any>(null);
  const [posSessionChecked, setPosSessionChecked] = useState(false);

  // Active department + tab — derived from the URL (Phase 3 route-driven navigation)
  const erpPathMatch = React.useMemo(() => {
    const match = location.pathname.match(/^\/erp\/([^/]+)(?:\/([^/]+))?/);
    if (!match) return null;
    const dept = DEPARTMENT_BY_SEGMENT[match[1]];
    if (!dept) return null;
    return { dept, tabId: match[2] || dept.defaultTab };
  }, [location.pathname]);

  const activeDept: DepartmentKey = erpPathMatch?.dept.key ?? 'frontoffice';
  const activeTab = erpPathMatch?.tabId ?? 'dashboard';

  // Accent class for the active department — applied to the side nav AND the
  // main content wrapper so buttons / active items adopt the department's
  // signature color while staying within the earthy-luxury brand palette.
  // The mapping lives in `departments.ts` (getDeptAccentClass) as the single
  // source of truth, shared with the DepartmentSwitcher.
  const activeAccentClass = getDeptAccentClass(activeDept);
  // Only apply the accent class on ERP routes (avoid coloring login/booking/POS)
  const isErpRoute = location.pathname.startsWith('/erp');

  // Routes that render without the ERP chrome (side nav + hover header).
  // Trailing-slash tolerant so `/login/` doesn't leak the nav.
  // Also chromeless on admin subdomain regardless of path.
  const isChromelessRoute = isAdminSubdomain || ['/login', '/pos', '/booking', '/public-portal', '/guest', '/guest-portal', '/kds', '/admin', '/kds-management']
    .some(p => location.pathname === p || location.pathname.startsWith(`${p}/`));
  // Hide chrome until the session check resolves — otherwise an unauthenticated
  // user landing on /erp sees the nav flash during "Verifying secure session..."
  // before being redirected to /login. Also hidden during forced password change.
  const showAppChrome = sessionChecked && !mustChangePassword && !isChromelessRoute;

  // Side navigation collapsed state
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Auto-hide header - only visible on mouse hover at top of screen
  const [headerVisible, setHeaderVisible] = useState(false);
  React.useEffect(() => {
    const handleScroll = () => {
      // Hide when scrolled down, only show via mouse hover
      if (window.scrollY > 10) {
        setHeaderVisible(false);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const { systemUsers, syncUserProfile } = useERP();

  React.useEffect(() => {
    let active = true;
    verifySession().then(user => {
      if (!active) return;
      if (user) {
        setCurrentUser(user);
        // Sync userProfile with actual authentication data
        syncUserProfile({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          roleDescription: user.roleDescription,
          avatar: user.avatarInitials,
          lastLogin: user.lastLogin || new Date().toISOString(),
          department: user.department,
          employeeId: user.employeeId,
          mobileNumber: user.mobileNumber,
          username: user.username,
          status: user.status,
        });
        // Phase 3: department is now URL-driven — no setActiveDept needed.
        // If the user is on /erp (index), ErpIndexRedirect will redirect to
        // their default department based on their role.
      }
      setSessionChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Restore POS session — any ERP session with outlet assignments grants POS
  // access. Runs once per signed-in user id so a POS-only login (which leaves
  // currentUser null) is not disturbed.
  const currentUserId = currentUser?.id;
  React.useEffect(() => {
    if (!sessionChecked) return;
    if (!currentUserId) {
      setPosSessionChecked(true);
      return;
    }
    let active = true;
    fetchPOSOutlets()
      .then(outlets => {
        if (!active) return;
        setPosUser(outlets.length > 0 ? buildPOSUser(currentUser, outlets) : null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPosSessionChecked(true);
      });
    return () => {
      active = false;
    };
  }, [sessionChecked, currentUserId]);

  // Sync currentUser permissions and active state in real time
  React.useEffect(() => {
    if (currentUser) {
      const liveUser = systemUsers.find(u => u.id === currentUser.id);
      if (liveUser) {
        if (liveUser.status === 'Inactive' || liveUser.status === 'Pending') {
          setCurrentUser(null);
          return;
        }
        // Check if role-relevant fields changed — if so, re-enrich via verifySession
        const roleChanged = liveUser.role !== currentUser.role ||
          liveUser.customRoleId !== currentUser.customRoleId ||
          liveUser.status !== currentUser.status;
        if (roleChanged) {
          // Re-verify session to get fresh enriched permissions
          verifySession().then(enriched => {
            if (enriched) setCurrentUser(enriched);
          });
          return;
        }
        // Otherwise, merge liveUser fields but preserve enriched fields
        if (JSON.stringify(liveUser) !== JSON.stringify(currentUser)) {
          setCurrentUser({
            ...liveUser,
            allowedTabs: currentUser.allowedTabs,
            allowedSettings: currentUser.allowedSettings,
            moduleAccess: currentUser.moduleAccess,
          });
        }
      }
    }
  }, [systemUsers, currentUser]);

  // Auto-refresh ERP data after 30 seconds of inactivity
  React.useEffect(() => {
    if (!currentUser) return;
    const INACTIVITY_MS = 30000;
    let lastActivity = Date.now();
    let refreshing = false;

    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    const updateLastActivity = () => { lastActivity = Date.now(); };
    activityEvents.forEach(event => {
      window.addEventListener(event, updateLastActivity, { passive: true });
    });

    const intervalId = window.setInterval(() => {
      if (refreshing) return;
      if (Date.now() - lastActivity >= INACTIVITY_MS) {
        refreshing = true;
        refreshAllData().finally(() => {
          lastActivity = Date.now();
          refreshing = false;
        });
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      activityEvents.forEach(event => {
        window.removeEventListener(event, updateLastActivity);
      });
    };
  }, [currentUser, refreshAllData]);

  const handleLoginSuccess = (user: User, forcePasswordChange?: boolean) => {
    setCurrentUser(user);
    syncUserProfile({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleDescription: user.roleDescription,
      avatar: user.avatarInitials,
      lastLogin: user.lastLogin || new Date().toISOString(),
      department: user.department,
      employeeId: user.employeeId,
      mobileNumber: user.mobileNumber,
      username: user.username,
      status: user.status,
    });

    if (forcePasswordChange) {
      setMustChangePassword(true);
      navigate('/erp'); // Navigate to trigger the forced password screen
      return;
    }

    const redirect = new URLSearchParams(location.search).get('redirect');
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      navigate(redirect);
    } else if (user.isSuperAdmin && isAdminSubdomain) {
      // Already on admin subdomain, stay there
      navigate('/admin');
    } else if (user.isSuperAdmin && !isAdminSubdomain) {
      // Super-admin on main domain - redirect to admin subdomain
      const adminUrl = `https://admin.${window.location.hostname.split('.').slice(-2).join('.')}/admin`;
      window.location.href = adminUrl;
    } else if (tenantCode && user.availableTenants) {
      // On tenant subdomain - verify access and stay
      const hasAccess = user.availableTenants.some(t => t.code === tenantCode);
      if (!hasAccess) {
        // Redirect to main domain if no access
        window.location.href = `https://${window.location.hostname.split('.').slice(-2).join('.')}`;
        return;
      }
      navigate(getDefaultErpPath(user));
    } else {
      // Main domain - navigate to default ERP path
      navigate(getDefaultErpPath(user));
    }

    // Re-fetch all ERP data now that the user is authenticated.
    // Sub-contexts fired their initial refreshData() on mount while
    // unauthenticated, so those calls returned 401 and left state empty.
    refreshAllData();
  };

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
  };

  const handlePOSLoginSuccess = (user: any) => {
    setPosUser(user);
    setPosSessionChecked(true);
    // POS login mints a full ERP session — sync the shared user state so
    // cashier identity, permissions and userProfile resolve consistently.
    if (user?.erpUser) {
      setCurrentUser(user.erpUser);
      syncUserProfile({
        id: user.erpUser.id,
        name: user.erpUser.name,
        email: user.erpUser.email,
        role: user.erpUser.role,
        roleDescription: user.erpUser.roleDescription,
        avatar: user.erpUser.avatarInitials,
        lastLogin: user.erpUser.lastLogin || new Date().toISOString(),
        department: user.erpUser.department,
        employeeId: user.erpUser.employeeId,
        mobileNumber: user.erpUser.mobileNumber,
        username: user.erpUser.username,
        status: user.erpUser.status,
      });
    }
  };

  const handlePOSLogout = async () => {
    await logout();
    await supabase.auth.signOut();
    setPosUser(null);
    setCurrentUser(null);
    navigate('/pos/login');
  };

  // Phase 3: *Dir state removed — tab is now derived from the URL (activeTab)

  // Notification panel toggle on ERP
  const [showNotifications, setShowNotifications] = useState(false);

  // Global Check In Print Modal
  const [printGuestForm, setPrintGuestForm] = useState<{guestName: string, guestEmail: string, guestPhone: string, reservationId: string, roomNumber: string, checkInDate: string} | null>(null);
  const [printGroupForm, setPrintGroupForm] = useState<{groupName: string, contactName: string, contactEmail: string, contactPhone: string, groupId: string, roomCount: number, checkInDate: string} | null>(null);

  const getUnreadNotifCount = () => notifications.filter(n => !n.read).length;

  // Helper: check if current user has read access to a sub-module
  const hasModuleAccess = (modId: string): boolean => {
    if (!currentUser?.moduleAccess || Object.keys(currentUser.moduleAccess).length === 0) return true;
    const access = currentUser.moduleAccess[modId];
    if (access === undefined) return true;
    return typeof access === 'boolean' ? access : access?.read === true;
  };

  // Phase 3: deptSubModuleMap, access-control useEffects, isModuleDisabled,
  // and admin module-toggle useEffect removed — all access control is now
  // handled by DepartmentRoute at the route level.

  // Platform controls: a department portal can be disabled web-app-wide from
  // System Admin > Platform Controls. Admin and account settings are never gated.
  const moduleToggles = globalHotelSettings.moduleToggles || {};

  // Compute sub-navigation items for the active department
  const subNavItems: { id: string; label: string; modId: string; icon?: LucideIcon; section?: string }[] = React.useMemo(() => {
    const subNavConfig: Record<string, { id: string; label: string; modId: string; icon?: LucideIcon; section?: string }[]> = {
      frontoffice: [
        { id: 'dashboard', label: 'Dashboard', modId: 'fo_dashboard', icon: LayoutDashboard },
        { id: 'reservations', label: 'Reservations', modId: 'fo_reservations', icon: Calendar },
        { id: 'availability-inventory', label: 'Availability', modId: 'fo_availability', icon: Grid3x3 },
        { id: 'front-desk-operations', label: 'Front Desk Ops', modId: 'fo_front_desk_ops', icon: DoorOpen },
        { id: 'room-assignment', label: 'Room Assignment', modId: 'fo_room_assignment', icon: BedDouble },
        { id: 'guest-profiles', label: 'Guest Profiles', modId: 'fo_guest_profiles', icon: Users },
        { id: 'group-profiles-management', label: 'Group Profiles', modId: 'fo_group_profiles', icon: Users },
        { id: 'check-in', label: 'Check-In', modId: 'fo_check_in', icon: Key },
        { id: 'check-out', label: 'Check-Out', modId: 'fo_check_out', icon: CreditCard },
        { id: 'folio-billing', label: 'Folio & Billing', modId: 'fo_folio', icon: FileText },
        { id: 'night-audit', label: 'Night Audit', modId: 'fo_night_audit', icon: MoonIcon },
        { id: 'keys-access', label: 'Keys & Access', modId: 'fo_keys_access', icon: KeySquare },
        { id: 'concierge-portal', label: 'Concierge Portal', modId: 'fo_concierge_portal', icon: Crown },
        { id: 'guest-requests', label: 'Guest Requests', modId: 'fo_guest_requests', icon: BellIcon },
        { id: 'lost-found', label: 'Lost & Found', modId: 'fo_lost_found', icon: Search },
        { id: 'communication-center', label: 'Comms', modId: 'fo_communication', icon: MessageSquare },
        { id: 'requisitions', label: 'Requisitions', modId: 'fo_requisitions', icon: ClipboardList },
        { id: 'inventory-consumption', label: 'Inventory Consumption', modId: 'fo_inventory_consumption', icon: Package },
        { id: 'reports', label: 'Reports', modId: 'fo_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Config', modId: 'fo_configuration', icon: Settings },
        { id: 'staff', label: 'Staff Management', modId: 'fo_staff', icon: Users },
      ],
      housekeeping: [
        // 19 modules — Room Cleaning (§7) + Public Area (§8) consolidated into Task Management (§6).
        { id: 'dashboard', label: 'Dashboard', modId: 'hk_dashboard', icon: LayoutDashboard },
        { id: 'rooms', label: 'Room Status', modId: 'hk_rooms', icon: BedDouble },
        { id: 'tasks', label: 'Task Management', modId: 'hk_tasks', icon: ClipboardList },
        { id: 'inspections', label: 'Room Inspections', modId: 'hk_inspections', icon: ClipboardCheck },
        { id: 'staff', label: 'Staff Management', modId: 'hk_staff', icon: Users },
        { id: 'supervisor', label: 'Supervisor Console', modId: 'hk_supervisor', icon: Eye },
        { id: 'laundry', label: 'Laundry Interface', modId: 'hk_laundry', icon: HandPlatter },
        { id: 'amenities', label: 'Amenities Management', modId: 'hk_amenities', icon: Gift },
        { id: 'minibar', label: 'Minibar Operations', modId: 'hk_minibar', icon: Wine },
        { id: 'lostfound', label: 'Lost & Found', modId: 'hk_lostfound', icon: Search },
        { id: 'guest-requests', label: 'Guest Requests', modId: 'hk_guest_requests', icon: BellIcon },
        { id: 'deep-cleaning', label: 'Deep Cleaning', modId: 'hk_deep_cleaning', icon: Brush },
        { id: 'preventive-cleaning', label: 'Preventive Cleaning', modId: 'hk_preventive', icon: SprayCan },
        { id: 'maintenance', label: 'Maintenance Coordination', modId: 'hk_maintenance', icon: Wrench },
        { id: 'inventory', label: 'Inventory', modId: 'hk_inventory', icon: Package },
        { id: 'communication', label: 'Communication Center', modId: 'hk_communication', icon: MessageSquare },
        { id: 'reports', label: 'Reports', modId: 'hk_reports', icon: BarChart3 },
        { id: 'configuration', label: 'Configuration', modId: 'hk_configuration', icon: Settings },
      ],
      'f&b': [
        { id: 'executive-dashboard', label: 'Executive Dashboard', modId: 'fb_executive_dashboard', icon: LayoutDashboard },
        { id: 'outlet-management', label: 'Outlet Management', modId: 'fb_outlet_management', icon: Store },
        { id: 'menu-management', label: 'Menu Management', modId: 'fb_menu_management', icon: BookOpen },
        { id: 'recipe-management', label: 'Recipe Management', modId: 'fb_recipe_management', icon: ChefHat },
        { id: 'pricing-packages', label: 'Pricing & Packages', modId: 'fb_pricing_packages', icon: DollarSign },
        { id: 'service-operations', label: 'Service Operations', modId: 'fb_service_operations', icon: Utensils },
        { id: 'production-coordination', label: 'Production Coordination', modId: 'fb_production_coordination', icon: Layers },
        { id: 'banquet-fb', label: 'Banquet F&B', modId: 'fb_banquet_fb', icon: PartyPopper },
        { id: 'room-service', label: 'Room Service', modId: 'fb_room_service', icon: HandPlatter },
        { id: 'inventory-coordination', label: 'Inventory', modId: 'fb_inventory_coordination', icon: Package },
        { id: 'guest-experience', label: 'Guest Experience', modId: 'fb_guest_experience', icon: Users },
        { id: 'staff-operations', label: 'F&B Staff Operations', modId: 'fb_staff_operations', icon: IdCard },
        { id: 'quality-compliance', label: 'Quality & Compliance', modId: 'fb_quality_compliance', icon: ClipboardCheck },
        { id: 'financials', label: 'Financials & Analytics', modId: 'fb_financials', icon: BarChart3 },
        { id: 'reports', label: 'Reports', modId: 'fb_reports', icon: FileText },
        { id: 'configuration', label: 'Configuration', modId: 'fb_configuration', icon: Settings },
        { id: 'integrations', label: 'Integrations', modId: 'fb_integrations', icon: Network },
      ],
      maintenance: [
        { id: 'dashboard', label: 'Dashboard', modId: 'eng_dashboard', icon: LayoutDashboard },
        { id: 'work-requests', label: 'Work Requests', modId: 'eng_work_requests', icon: ClipboardList },
        { id: 'workorders', label: 'Work Orders', modId: 'eng_workorders', icon: Wrench },
        { id: 'corrective-maintenance', label: 'Corrective Maint.', modId: 'eng_corrective_maintenance', icon: Wrench },
        { id: 'pm', label: 'Preventive Maint.', modId: 'eng_pm', icon: Calendar },
        { id: 'equipment-registry', label: 'Equipment Registry', modId: 'eng_equipment_registry', icon: HardDrive },
        { id: 'building-maintenance', label: 'Building Maint.', modId: 'eng_building_maintenance', icon: Building },
        { id: 'energy-management', label: 'Energy Management', modId: 'eng_energy_management', icon: Gauge },
        { id: 'spare-parts', label: 'Spare Parts & Tools', modId: 'eng_spare_parts', icon: Package },
        { id: 'inspections', label: 'Inspections', modId: 'eng_inspections', icon: ClipboardCheck },
        { id: 'calibration', label: 'Calibration', modId: 'eng_calibration', icon: SlidersHorizontal },
        { id: 'projects-renovations', label: 'Projects & Renovations', modId: 'eng_projects', icon: HardHat },
        { id: 'communication', label: 'Communication', modId: 'eng_communication', icon: MessageSquare },
        { id: 'configuration', label: 'Configuration', modId: 'eng_configuration', icon: Settings },
        { id: 'rooms', label: 'Guest Rooms', modId: 'eng_rooms', icon: BedDouble },
        { id: 'utilities', label: 'Utilities & Plant', modId: 'eng_utilities', icon: Activity },
        { id: 'staff', label: 'Technicians', modId: 'eng_staff', icon: Users },
        { id: 'compliance', label: 'Safety & Compliance', modId: 'eng_compliance', icon: ShieldCheck },
        { id: 'reports', label: 'Reports', modId: 'eng_reports', icon: FileBarChart },
      ],
      inventory: [
        { id: 'dashboard', label: 'Dashboard', modId: 'inv_dashboard', icon: LayoutDashboard },
        { id: 'items', label: 'Item & Material Master', modId: 'inv_items', icon: Package },
        { id: 'inventory', label: 'Inventory Control', modId: 'inv_inventory', icon: Boxes },
        { id: 'stores', label: 'Stores & Warehouses', modId: 'inv_stores', icon: Building },
        { id: 'stock-operations', label: 'Stock Operations', modId: 'inv_stock_operations', icon: ArrowRightLeft },
        { id: 'storekeeping', label: 'Storekeeping', modId: 'inv_storekeeping', icon: Package },
        { id: 'stock-control', label: 'Stock Control', modId: 'inv_stock_control', icon: SlidersHorizontal },
        { id: 'reservations', label: 'Reservations & Allocations', modId: 'inv_reservations_allocations', icon: Calendar },
        { id: 'replenishment-procurement', label: 'Replenishment & Procurement', modId: 'inv_replenishment', icon: TrendingUp },
        { id: 'assets-resources', label: 'Assets & Resources', modId: 'inv_fixed_assets', icon: Boxes },
        { id: 'reports', label: 'Valuation & Reports', modId: 'inv_reports', icon: BarChart3 },
        { id: 'audit', label: 'Audit & Compliance', modId: 'inv_audit', icon: Gavel },
        { id: 'advanced-operations', label: 'Advanced Operations', modId: 'inv_advanced_operations', icon: Wrench },
        { id: 'configuration', label: 'Configuration', modId: 'inv_configuration', icon: Settings },
      ],
      finance: [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'fin_dashboard', icon: LayoutDashboard },
        { id: 'gl', label: 'General Ledger', modId: 'fin_gl', icon: BookOpen },
        { id: 'coa', label: 'Chart of Accounts', modId: 'fin_coa', icon: FolderOpen },
        { id: 'folio-billing', label: 'Folio Management', modId: 'fin_folio', icon: FileText },
        { id: 'ar', label: 'Accounts Receivable', modId: 'fin_ar', icon: Receipt },
        { id: 'ap', label: 'Accounts Payable', modId: 'fin_ap', icon: Receipt },
        { id: 'cash_bank', label: 'Cash & Bank', modId: 'fin_cash_bank', icon: Wallet },
        { id: 'treasury', label: 'Treasury', modId: 'fin_treasury', icon: Landmark },
        { id: 'revenue', label: 'Revenue', modId: 'fin_revenue', icon: TrendingUp },
        { id: 'expense', label: 'Expense', modId: 'fin_expense', icon: Banknote },
        { id: 'cost_center', label: 'Cost Center', modId: 'fin_cost_center', icon: Target },
        { id: 'budgeting', label: 'Budgeting', modId: 'fin_budgeting', icon: PiggyBank },
        { id: 'fixed_assets', label: 'Fixed Assets', modId: 'fin_fixed_assets', icon: Boxes },
        { id: 'inventory', label: 'Inventory', modId: 'fin_inventory', icon: Package },
        { id: 'intercompany', label: 'Intercompany', modId: 'fin_intercompany', icon: Network },
        { id: 'tax', label: 'Tax', modId: 'fin_tax', icon: Scale },
        { id: 'financial_close', label: 'Financial Close', modId: 'fin_financial_close', icon: Lock },
        { id: 'consolidation', label: 'Consolidation', modId: 'fin_consolidation', icon: Layers },
        { id: 'audit_compliance', label: 'Audit', modId: 'fin_audit_compliance', icon: Gavel },
        { id: 'documents', label: 'Documents', modId: 'fin_documents', icon: FileText },
        { id: 'approval', label: 'Approvals', modId: 'fin_approval', icon: CheckSquare },
        { id: 'bi', label: 'Business Intel', modId: 'fin_bi', icon: BarChart3 },
        { id: 'requisitions', label: 'Requisitions', modId: 'fin_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'fin_reports', icon: FileBarChart },
        { id: 'config', label: 'Configuration', modId: 'fin_config', icon: Settings },
      ],
      hr: [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'hr_dashboard', icon: LayoutDashboard },
        { id: 'organization', label: 'Organization Management', modId: 'hr_organization', icon: Building2 },
        { id: 'employees', label: 'Employee Management', modId: 'hr_employees', icon: Users },
        { id: 'recruitment', label: 'Recruitment', modId: 'hr_recruitment', icon: UserPlus },
        { id: 'ats', label: 'Applicant Tracking (ATS)', modId: 'hr_ats', icon: ClipboardList },
        { id: 'onboarding', label: 'Onboarding', modId: 'hr_onboarding', icon: UserCheck },
        { id: 'ess', label: 'Employee Self-Service', modId: 'hr_ess', icon: IdCard },
        { id: 'mss', label: 'Manager Self-Service', modId: 'hr_mss', icon: Briefcase },
        { id: 'attendance', label: 'Attendance Management', modId: 'hr_attendance', icon: Calendar },
        { id: 'shifts', label: 'Shift & Rostering', modId: 'hr_shifts', icon: CalendarDays },
        { id: 'leave', label: 'Leave Management', modId: 'hr_leave', icon: CalendarOff },
        { id: 'overtime', label: 'Time & Overtime', modId: 'hr_overtime', icon: Clock },
        { id: 'payroll', label: 'Payroll Management', modId: 'hr_payroll', icon: Banknote },
        { id: 'compensation', label: 'Compensation & Benefits', modId: 'hr_compensation', icon: Gift },
        { id: 'performance', label: 'Performance Management', modId: 'hr_performance', icon: Target },
        { id: 'learning', label: 'Learning & Development', modId: 'hr_learning', icon: GraduationCap },
        { id: 'training', label: 'Training Management', modId: 'hr_training', icon: BookOpen },
        { id: 'career', label: 'Career & Succession', modId: 'hr_career', icon: TrendingUp },
        { id: 'health', label: 'Health & Safety', modId: 'hr_health', icon: HeartPulse },
        { id: 'relations', label: 'Employee Relations', modId: 'hr_relations', icon: Handshake },
        { id: 'documents', label: 'Document Management', modId: 'hr_documents', icon: FolderArchive },
        { id: 'workflow', label: 'Workflow & Approvals', modId: 'hr_workflow', icon: Workflow },
        { id: 'requisitions', label: 'Requisitions', modId: 'hr_requisitions', icon: ClipboardList },
        { id: 'analytics', label: 'Reports & Analytics', modId: 'hr_analytics', icon: BarChart3 },
        { id: 'configuration', label: 'Configuration', modId: 'hr_configuration', icon: Settings },
        { id: 'offboarding', label: 'Offboarding', modId: 'hr_offboarding', icon: UserMinus },
        { id: 'accrual', label: 'Leave Accrual', modId: 'hr_accrual', icon: CalendarPlus },
        { id: 'contract-expiry', label: 'Contract Expiry', modId: 'hr_contract_expiry', icon: FileWarning },
        { id: 'loans', label: 'Loan Management', modId: 'hr_loans', icon: Banknote },
      ],
      security: [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'sec_dashboard', icon: LayoutDashboard },
        { id: 'soc', label: 'Security Operations Center', modId: 'sec_soc', icon: Shield },
        { id: 'incidents', label: 'Incident Management', modId: 'sec_incidents', icon: AlertTriangle },
        { id: 'investigations', label: 'Investigations', modId: 'sec_investigations', icon: Search },
        { id: 'visitors', label: 'Visitor Management', modId: 'sec_visitors', icon: Users },
        { id: 'access-control', label: 'Access Control', modId: 'sec_access', icon: Lock },
        { id: 'keys', label: 'Key & Keycard Management', modId: 'sec_keys', icon: Key },
        { id: 'cctv', label: 'CCTV Management', modId: 'sec_cctv', icon: Cctv },
        { id: 'patrols', label: 'Patrol Management', modId: 'sec_patrols', icon: Footprints },
        { id: 'lost-found', label: 'Lost & Found Oversight', modId: 'sec_lostfound', icon: Search },
        { id: 'emergency', label: 'Emergency Management', modId: 'sec_emergency', icon: Siren },
        { id: 'fire-safety', label: 'Fire & Life Safety', modId: 'sec_firesafety', icon: Flame },
        { id: 'risk', label: 'Risk Management', modId: 'sec_risk', icon: AlertCircle },
        { id: 'business-continuity', label: 'Business Continuity', modId: 'sec_businesscontinuity', icon: LifeBuoy },
        { id: 'crisis', label: 'Crisis Management', modId: 'sec_crisis', icon: AlertTriangle },
        { id: 'health-safety', label: 'Health & Safety Coordination', modId: 'sec_healthsafety', icon: HeartPulse },
        { id: 'compliance', label: 'Compliance Management', modId: 'sec_compliance', icon: ShieldCheck },
        { id: 'asset-protection', label: 'Asset Protection', modId: 'sec_assetprotection', icon: Shield },
        { id: 'fraud-prevention', label: 'Fraud Prevention', modId: 'sec_fraudprevention', icon: Fingerprint },
        { id: 'evidence', label: 'Evidence Management', modId: 'sec_evidence', icon: FolderArchive },
        { id: 'communication', label: 'Communication Center', modId: 'sec_communication', icon: MessageSquare },
        { id: 'staff', label: 'Staff Management', modId: 'sec_staff', icon: Users },
        { id: 'requisitions', label: 'Requisitions', modId: 'sec_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'sec_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Configuration', modId: 'sec_configuration', icon: Settings },
      ],
      transportation: [
        { id: 'dashboard', label: 'Dashboard', modId: 'trans_dashboard', icon: LayoutDashboard },
        { id: 'my-trips', label: 'My Trips', modId: 'trans_my_trips', icon: Car },
        { id: 'requests', label: 'Requests', modId: 'trans_requests', icon: ClipboardList },
        { id: 'dispatch', label: 'Dispatch Center', modId: 'trans_dispatch', icon: Truck },
        { id: 'trips', label: 'Trip Management', modId: 'trans_trips', icon: RouteIcon },
        { id: 'airport', label: 'Airport Transfers', modId: 'trans_airport', icon: Plane },
        { id: 'shuttle', label: 'Shuttle Management', modId: 'trans_shuttle', icon: Bus },
        { id: 'guest', label: 'Guest Transportation', modId: 'trans_guest', icon: Users },
        { id: 'corporate', label: 'Corporate Transportation', modId: 'trans_corporate', icon: Briefcase },
        { id: 'staff', label: 'Staff Transportation', modId: 'trans_staff', icon: Users },
        { id: 'fleet', label: 'Fleet Management', modId: 'trans_fleet', icon: Car },
        { id: 'vehicles', label: 'Vehicle Registry', modId: 'trans_vehicles', icon: Car },
        { id: 'drivers', label: 'Driver Management', modId: 'trans_drivers', icon: IdCard },
        { id: 'routes', label: 'Route Management', modId: 'trans_routes', icon: MapPin },
        { id: 'scheduling', label: 'Scheduling & Dispatch', modId: 'trans_scheduling', icon: Calendar },
        { id: 'gps', label: 'GPS Tracking', modId: 'trans_gps', icon: MapPin },
        { id: 'fuel', label: 'Fuel Management', modId: 'trans_fuel', icon: Fuel },
        { id: 'maintenance', label: 'Vehicle Maintenance', modId: 'trans_maintenance', icon: Wrench },
        { id: 'contractors', label: 'Contractors', modId: 'trans_contractors', icon: Briefcase },
        { id: 'billing', label: 'Billing & Charges', modId: 'trans_billing', icon: Receipt },
        { id: 'communication', label: 'Communication Center', modId: 'trans_communication', icon: MessageSquare },
        { id: 'requisitions', label: 'Requisitions', modId: 'trans_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'trans_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Configuration', modId: 'trans_configuration', icon: Settings },
      ],
      procurement: [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'proc_dashboard', icon: LayoutDashboard },
        { id: 'demand-planning', label: 'Demand Planning', modId: 'proc_demand_planning', icon: TrendingUp },
        { id: 'procurement-planning', label: 'Procurement Planning', modId: 'proc_planning', icon: Calendar },
        { id: 'requisitions', label: 'Purchase Requisitions', modId: 'proc_requisitions', icon: ClipboardList },
        { id: 'rfq', label: 'RFQ Management', modId: 'proc_rfq', icon: FileText },
        { id: 'tenders', label: 'Tender Management', modId: 'proc_tenders', icon: Gavel },
        { id: 'negotiations', label: 'Negotiations', modId: 'proc_negotiations', icon: MessageSquare },
        { id: 'orders', label: 'Purchase Orders', modId: 'proc_orders', icon: ShoppingCart },
        { id: 'po-tracking', label: 'PO Tracking', modId: 'proc_po_tracking', icon: Truck },
        { id: 'approvals', label: 'Approval Center', modId: 'proc_approvals', icon: CheckSquare },
        { id: 'suppliers', label: 'Supplier Directory', modId: 'proc_suppliers', icon: Briefcase },
        { id: 'onboarding', label: 'Supplier Onboarding', modId: 'proc_onboarding', icon: UserPlus },
        { id: 'qualification', label: 'Supplier Qualification', modId: 'proc_qualification', icon: Award },
        { id: 'evaluation', label: 'Supplier Evaluation', modId: 'proc_evaluation', icon: Star },
        { id: 'documents', label: 'Supplier Documents', modId: 'proc_documents', icon: FileText },
        { id: 'contracts', label: 'Contract Management', modId: 'proc_contracts', icon: FileText },
        { id: 'budget', label: 'Procurement Budget', modId: 'proc_budget', icon: PiggyBank },
        { id: 'receiving', label: 'Receiving Coordination', modId: 'proc_receiving', icon: HardDriveDownload },
        { id: 'risk', label: 'Risk Management', modId: 'proc_risk', icon: ShieldAlert },
        { id: 'analytics', label: 'Procurement Analytics', modId: 'proc_analytics', icon: BarChart3 },
        { id: 'reports', label: 'Reports', modId: 'proc_reports', icon: FileBarChart },
        { id: 'config', label: 'Configuration', modId: 'proc_config', icon: Settings },
      ],
      sales: [
        { id: 'dashboard', label: 'Dashboard', modId: 'sales_dashboard', icon: LayoutDashboard },
        { id: 'crm', label: 'CRM', modId: 'sales_crm', icon: Users },
        { id: 'guest-profiles', label: 'Guest Profiles', modId: 'sales_guest_profiles', icon: Users },
        { id: 'corporate-accounts', label: 'Corporate Accounts', modId: 'sales_corporate_accounts', icon: Briefcase },
        { id: 'travel-agents', label: 'Travel Agents', modId: 'sales_travel_agents', icon: Briefcase },
        { id: 'leads', label: 'Leads', modId: 'sales_leads', icon: TrendingUp },
        { id: 'opportunities', label: 'Opportunities', modId: 'sales_opportunities', icon: Target },
        { id: 'proposals', label: 'Proposals', modId: 'sales_proposals', icon: FileText },
        { id: 'contracts', label: 'Contracts', modId: 'sales_contracts', icon: FileText },
        { id: 'sales-activities', label: 'Activities', modId: 'sales_activities', icon: Calendar },
        { id: 'account-management', label: 'Account Mgmt', modId: 'sales_account_management', icon: Users },
        { id: 'staff', label: 'Staff', modId: 'sales_staff', icon: Users },
        { id: 'campaigns', label: 'Campaigns', modId: 'sales_campaigns', icon: Tag },
        { id: 'email-marketing', label: 'Email', modId: 'sales_email_marketing', icon: Mail },
        { id: 'sms-messaging', label: 'SMS', modId: 'sales_sms_messaging', icon: MessageSquare },
        { id: 'loyalty', label: 'Loyalty', modId: 'sales_loyalty', icon: Gift },
        { id: 'promotions', label: 'Promotions', modId: 'sales_promotions', icon: Tag },
        { id: 'gift-cards', label: 'Gift Cards', modId: 'sales_gift_cards', icon: Gift },
        { id: 'reputation', label: 'Reputation', modId: 'sales_reputation', icon: Star },
        { id: 'guest-feedback', label: 'Feedback', modId: 'sales_guest_feedback', icon: MessageSquare },
        { id: 'segmentation', label: 'Segmentation', modId: 'sales_segmentation', icon: PieChart },
        { id: 'communication', label: 'Communication', modId: 'sales_communication', icon: MessageSquare },
        { id: 'requisitions', label: 'Requisitions', modId: 'sales_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'sales_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Configuration', modId: 'sales_configuration', icon: Settings },
      ],
      concierge: [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'concierge_dashboard', icon: LayoutDashboard },
        { id: 'service-center', label: 'Guest Service Center', modId: 'concierge_service_center', icon: Users },
        { id: 'guest-profiles', label: 'Guest Profiles', modId: 'concierge_guest_profiles', icon: Users },
        { id: 'guest-requests', label: 'Guest Requests', modId: 'concierge_guest_requests', icon: BellIcon },
        { id: 'concierge-desk', label: 'Concierge Desk', modId: 'concierge_desk', icon: MapPin },
        { id: 'experience-booking', label: 'Experience Booking', modId: 'concierge_experience_booking', icon: Star },
        { id: 'restaurant-reservations', label: 'Restaurant Reservations', modId: 'concierge_restaurant_reservations', icon: Utensils },
        { id: 'transportation', label: 'Transportation', modId: 'concierge_transportation', icon: Car },
        { id: 'tour-management', label: 'Tour Management', modId: 'concierge_tour_management', icon: MapPin },
        { id: 'ticketing', label: 'Ticketing Services', modId: 'concierge_ticketing', icon: Ticket },
        { id: 'luggage-services', label: 'Luggage Services', modId: 'concierge_luggage_services', icon: Package },
        { id: 'parcel-management', label: 'Parcel Management', modId: 'concierge_parcel_management', icon: Package },
        { id: 'vip-services', label: 'VIP & Butler Services', modId: 'concierge_vip_services', icon: Crown },
        { id: 'personal-shopping', label: 'Personal Shopping', modId: 'concierge_personal_shopping', icon: ShoppingBag },
        { id: 'local-recommendations', label: 'Local Recommendations', modId: 'concierge_local_recommendations', icon: MapPin },
        { id: 'itinerary-planner', label: 'Itinerary Planner', modId: 'concierge_itinerary_planner', icon: Calendar },
        { id: 'wake-up-reminder', label: 'Wake-up & Reminder', modId: 'concierge_wake_up_reminder', icon: Clock },
        { id: 'guest-communication', label: 'Guest Communication', modId: 'concierge_guest_communication', icon: MessageSquare },
        { id: 'vendor-management', label: 'Vendor Management', modId: 'concierge_vendor_management', icon: Building2 },
        { id: 'billing-charges', label: 'Billing & Charges', modId: 'concierge_billing_charges', icon: DollarSign },
        { id: 'requisitions', label: 'Requisitions', modId: 'concierge_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'concierge_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Configuration', modId: 'concierge_configuration', icon: Settings },
      ],
      'spa-wellness': [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'spa_dashboard', icon: LayoutDashboard },
        { id: 'appointments', label: 'Appointment Management', modId: 'spa_appointments', icon: Calendar },
        { id: 'treatment-catalog', label: 'Treatment Catalog', modId: 'spa_treatment_catalog', icon: Sparkles },
        { id: 'therapists', label: 'Therapist Management', modId: 'spa_therapists', icon: Users },
        { id: 'treatment-rooms', label: 'Rooms & Facilities', modId: 'spa_treatment_rooms', icon: Home },
        { id: 'guest-wellness-profiles', label: 'Guest Wellness Profiles', modId: 'spa_guest_wellness_profiles', icon: Heart },
        { id: 'wellness-programs', label: 'Wellness Programs', modId: 'spa_wellness_programs', icon: Target },
        { id: 'memberships', label: 'Membership Management', modId: 'spa_memberships', icon: Award },
        { id: 'fitness-center', label: 'Fitness Center', modId: 'spa_fitness_center', icon: Dumbbell },

        { id: 'wellness-packages', label: 'Wellness Packages', modId: 'spa_wellness_packages', icon: Gift },
        { id: 'retail-shop', label: 'Retail Shop', modId: 'spa_retail_shop', icon: ShoppingBag },
        { id: 'inventory', label: 'Inventory', modId: 'spa_inventory', icon: Package },
        { id: 'gift-cards', label: 'Gift Cards & Vouchers', modId: 'spa_gift_cards', icon: CreditCard },
        { id: 'billing-payments', label: 'Billing & Payments', modId: 'spa_billing_payments', icon: DollarSign },
        { id: 'communication', label: 'Communication Center', modId: 'spa_communication', icon: MessageSquare },
        { id: 'requisitions', label: 'Requisitions', modId: 'spa_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'spa_reports', icon: BarChart3 },
        { id: 'configuration', label: 'Configuration', modId: 'spa_configuration', icon: Settings },
      ],
      'banquet-events': [
        { id: 'dashboard', label: 'Executive Dashboard', modId: 'be_dashboard', icon: LayoutDashboard },
        { id: 'calendar', label: 'Event Calendar', modId: 'be_calendar', icon: Calendar },
        { id: 'event-setup', label: 'Event Booking', modId: 'be_event_setup', icon: Building2, section: 'Pipeline' },
        { id: 'room-blocks', label: 'Room Blocks', modId: 'be_room_blocks', icon: BedDouble, section: 'Pipeline' },
        { id: 'planning', label: 'Event Planning', modId: 'be_planning', icon: ClipboardList, section: 'Planning' },
        { id: 'catering', label: 'Catering Planning', modId: 'be_catering', icon: Utensils, section: 'Planning' },
        { id: 'logistics', label: 'Event Logistics', modId: 'be_logistics', icon: Truck, section: 'Planning' },
        { id: 'inventory-requisition', label: 'Inventory & Requisition', modId: 'be_inventory_requisition', icon: Package, section: 'Planning' },
        { id: 'beo', label: 'BEO', modId: 'be_beo', icon: FileText, section: 'Planning' },
        { id: 'execution', label: 'Event Execution', modId: 'be_execution', icon: CheckSquare, section: 'Operations' },
        { id: 'coordination', label: 'Coordination & Comms', modId: 'be_coordination', icon: Network, section: 'Operations' },
        { id: 'guest-experience', label: 'Guest Experience', modId: 'be_guest_experience', icon: Users, section: 'Operations' },
        { id: 'staff', label: 'Staff Management', modId: 'be_staff', icon: Users, section: 'Operations' },
        { id: 'billing', label: 'Billing & Deposits', modId: 'be_billing', icon: DollarSign, section: 'Billing' },
        { id: 'reports', label: 'Reports', modId: 'be_reports', icon: BarChart3, section: 'Support' },
        { id: 'configuration', label: 'Configuration', modId: 'be_configuration', icon: Settings, section: 'Support' },
      ],
      revenue: [
        { id: 'dashboard', label: 'Dashboard', modId: 'rms_dashboard', icon: LayoutDashboard },
        { id: 'recommendations', label: 'Recommendations', modId: 'rms_recommendations', icon: Target },
        { id: 'competitors', label: 'Competitors', modId: 'rms_competitors', icon: Users },
        { id: 'forecasts', label: 'Demand Forecasts', modId: 'rms_forecasts', icon: Activity },
        { id: 'los', label: 'LOS Rules', modId: 'rms_los', icon: Calendar },
        { id: 'corporate', label: 'Corporate Rates', modId: 'rms_corporate', icon: Briefcase },
        { id: 'channels', label: 'Channel Manager', modId: 'rms_channels', icon: Network },
        { id: 'dynamic_pricing', label: 'Dynamic Pricing', modId: 'rms_dynamic_pricing', icon: TrendingUp },
        { id: 'rate_management', label: 'Rate Management', modId: 'rms_rate_management', icon: DollarSign },
        { id: 'inventory_controls', label: 'Inventory Controls', modId: 'rms_inventory_controls', icon: BedDouble },
        { id: 'yield_management', label: 'Yield Management', modId: 'rms_yield_management', icon: Target },
        { id: 'market_segmentation', label: 'Segmentation', modId: 'rms_market_segmentation', icon: PieChart },
        { id: 'channel_performance', label: 'Channel Performance', modId: 'rms_channel_performance', icon: LineChart },
        { id: 'distribution_management', label: 'Distribution', modId: 'rms_distribution_management', icon: Layers },
        { id: 'group_evaluation', label: 'Group Evaluation', modId: 'rms_group_evaluation', icon: Users },
        { id: 'displacement_analysis', label: 'Displacement', modId: 'rms_displacement_analysis', icon: BarChart3 },
        { id: 'overbooking_management', label: 'Overbooking', modId: 'rms_overbooking_management', icon: AlertTriangle },
        { id: 'restrictions_management', label: 'Restrictions', modId: 'rms_restrictions_management', icon: Calendar },
        { id: 'package_pricing', label: 'Packages', modId: 'rms_package_pricing', icon: Package },
        { id: 'promotions_analysis', label: 'Promotions', modId: 'rms_promotions_analysis', icon: Tag },
        { id: 'business_intelligence', label: 'Business Intel', modId: 'rms_business_intelligence', icon: BarChart3 },
        { id: 'ai_recommendations', label: 'AI Recs', modId: 'rms_ai_recommendations', icon: Brain },
        { id: 'scenario_planning', label: 'Scenarios', modId: 'rms_scenario_planning', icon: Compass },
        { id: 'requisitions', label: 'Requisitions', modId: 'rms_requisitions', icon: ClipboardList },
        { id: 'reports', label: 'Reports', modId: 'rms_reports', icon: FileBarChart },
        { id: 'configuration', label: 'Configuration', modId: 'rms_configuration', icon: Settings },
      ],
    };

    // Executive and Operations share the same sub-nav
    const execOpsSubNav = [
      { id: 'executive-dashboard', label: 'Executive Dashboard', modId: activeDept === 'executive' ? 'exec_executive_dashboard' : 'ops_executive_dashboard', icon: LayoutDashboard },
      { id: 'enterprise-kpi-center', label: 'Enterprise KPI Center', modId: activeDept === 'executive' ? 'exec_enterprise_kpi_center' : 'ops_enterprise_kpi_center', icon: Target },
      { id: 'operational-intelligence', label: 'Operational Intelligence', modId: activeDept === 'executive' ? 'exec_operational_intelligence' : 'ops_operational_intelligence', icon: Activity },
      { id: 'financial-intelligence', label: 'Financial Intelligence', modId: activeDept === 'executive' ? 'exec_financial_intelligence' : 'ops_financial_intelligence', icon: DollarSign },
      { id: 'revenue-intelligence', label: 'Revenue Intelligence', modId: activeDept === 'executive' ? 'exec_revenue_intelligence' : 'ops_revenue_intelligence', icon: TrendingUp },
      { id: 'guest-intelligence', label: 'Guest Intelligence', modId: activeDept === 'executive' ? 'exec_guest_intelligence' : 'ops_guest_intelligence', icon: Users },
      { id: 'sales-marketing-intelligence', label: 'Sales & Marketing', modId: activeDept === 'executive' ? 'exec_sales_marketing_intelligence' : 'ops_sales_marketing_intelligence', icon: TrendingUp },
      { id: 'food-beverage-intelligence', label: 'F&B Intelligence', modId: activeDept === 'executive' ? 'exec_food_beverage_intelligence' : 'ops_food_beverage_intelligence', icon: Utensils },
      { id: 'housekeeping-intelligence', label: 'Housekeeping', modId: activeDept === 'executive' ? 'exec_housekeeping_intelligence' : 'ops_housekeeping_intelligence', icon: BedDouble },
      { id: 'engineering-intelligence', label: 'Engineering', modId: activeDept === 'executive' ? 'exec_engineering_intelligence' : 'ops_engineering_intelligence', icon: Wrench },
      { id: 'human-capital-intelligence', label: 'Human Capital', modId: activeDept === 'executive' ? 'exec_human_capital_intelligence' : 'ops_human_capital_intelligence', icon: Users },
      { id: 'procurement-intelligence', label: 'Procurement', modId: activeDept === 'executive' ? 'exec_procurement_intelligence' : 'ops_procurement_intelligence', icon: ShoppingCart },
      { id: 'inventory-intelligence', label: 'Inventory', modId: activeDept === 'executive' ? 'exec_inventory_intelligence' : 'ops_inventory_intelligence', icon: Package },
      { id: 'security-intelligence', label: 'Security', modId: activeDept === 'executive' ? 'exec_security_intelligence' : 'ops_security_intelligence', icon: Shield },
      { id: 'sustainability-intelligence', label: 'Sustainability', modId: activeDept === 'executive' ? 'exec_sustainability_intelligence' : 'ops_sustainability_intelligence', icon: Leaf },
      { id: 'benchmarking', label: 'Benchmarking', modId: activeDept === 'executive' ? 'exec_benchmarking' : 'ops_benchmarking', icon: Trophy },
      { id: 'forecasting', label: 'Forecasting', modId: activeDept === 'executive' ? 'exec_forecasting' : 'ops_forecasting', icon: LineChart },
      { id: 'ai-decision-support', label: 'AI Decision Support', modId: activeDept === 'executive' ? 'exec_ai_decision_support' : 'ops_ai_decision_support', icon: Brain },
      { id: 'strategic-planning', label: 'Strategic Planning', modId: activeDept === 'executive' ? 'exec_strategic_planning' : 'ops_strategic_planning', icon: Compass },
      { id: 'alerts-exceptions', label: 'Alerts & Exceptions', modId: activeDept === 'executive' ? 'exec_alerts_exceptions' : 'ops_alerts_exceptions', icon: AlertCircle },
      { id: 'approvals', label: 'Approvals', modId: activeDept === 'executive' ? 'exec_approvals' : 'ops_approvals', icon: CheckSquare },
      { id: 'reports-center', label: 'Reports Center', modId: activeDept === 'executive' ? 'exec_reports_center' : 'ops_reports_center', icon: FileBarChart },
      { id: 'configuration', label: 'Configuration', modId: activeDept === 'executive' ? 'exec_configuration' : 'ops_configuration', icon: Settings },
    ];
    subNavConfig.executive = execOpsSubNav;

    // Hotel Operations Portal has its own navigation structure
    const operationsSubNav = [
      { id: 'executive-dashboard', label: 'Executive Dashboard', modId: 'ops_executive_dashboard', icon: LayoutDashboard },
      { id: 'command-center', label: 'Operations Command Center', modId: 'ops_command_center', icon: Command },
      { id: 'daily-briefing', label: 'Daily Briefing', modId: 'ops_daily_briefing', icon: FileText },
      { id: 'morning-meeting', label: 'Morning Meeting', modId: 'ops_morning_meeting', icon: Users },
      { id: 'approvals', label: 'Manager Approvals', modId: 'ops_approvals', icon: CheckCircle2 },
      { id: 'cross-department-tasks', label: 'Cross-Department Tasks', modId: 'ops_cross_department_tasks', icon: ArrowRightLeft },
      { id: 'duty-manager', label: 'Duty Manager Workspace', modId: 'ops_duty_manager', icon: Briefcase },
      { id: 'calendar', label: 'Operational Calendar', modId: 'ops_calendar', icon: Calendar },
      { id: 'vip-management', label: 'VIP Guest Management', modId: 'ops_vip_management', icon: Star },
      { id: 'guest-recovery', label: 'Guest Recovery', modId: 'ops_guest_recovery', icon: Heart },
      { id: 'service-quality', label: 'Service Quality', modId: 'ops_service_quality', icon: Award },
      { id: 'room-operations', label: 'Room Operations', modId: 'ops_room_operations', icon: BedDouble },
      { id: 'occupancy-forecast', label: 'Occupancy & Forecast', modId: 'ops_occupancy_forecast', icon: TrendingUp },
      { id: 'event-coordination', label: 'Event & Group Coordination', modId: 'ops_event_coordination', icon: Ticket },
      { id: 'emergency', label: 'Emergency Coordination', modId: 'ops_emergency', icon: Flame },
      { id: 'communication', label: 'Communication Center', modId: 'ops_communication', icon: Megaphone },
      { id: 'escalations', label: 'Escalation Center', modId: 'ops_escalations', icon: AlertTriangle },
      { id: 'sop-compliance', label: 'SOP & Compliance', modId: 'ops_sop_compliance', icon: ListChecks },
      { id: 'executive-checklists', label: 'Executive Checklists', modId: 'ops_executive_checklists', icon: CheckSquare },
      { id: 'flash-reports', label: 'Daily Flash Reports', modId: 'ops_flash_reports', icon: FileBarChart },
      { id: 'requisitions', label: 'Requisitions', modId: 'ops_requisitions', icon: ClipboardList },
      { id: 'reports', label: 'Reports', modId: 'ops_reports', icon: FileCheck },
      { id: 'configuration', label: 'Configuration', modId: 'ops_configuration', icon: Settings },
    ];
    subNavConfig.operations = operationsSubNav;

    // Admin sub-nav from the shared admin module registry
    subNavConfig.admin = getVisibleAdminModules(moduleToggles)
      .map(m => ({ id: m.id, label: m.label, modId: m.id }));

    const items = subNavConfig[activeDept] || [];
    return items.filter(item =>
      (!item.modId || hasModuleAccess(item.modId)) &&
      isTabEnabledByToggles(activeDept, item.id, moduleToggles)
    );
  }, [activeDept, currentUser, moduleToggles]);

  // Phase 3: activeSubItem is now derived directly from the URL
  const activeSubItem = activeTab;

  // Phase 3: handleSubItemClick navigates to the new URL instead of setting state
  const handleSubItemClick = (id: string) => {
    const dept = DEPARTMENT_BY_KEY[activeDept];
    if (dept) navigate(`/erp/${dept.urlSegment}/${id}`);
  };

  return (
    <div data-route={location.pathname} className={`min-h-screen bg-slate-50 dark:bg-slate-950 font-sans transition-colors duration-300 selection:bg-amber-400 selection:text-slate-900 ${location.pathname === '/public-portal' || location.pathname === '/admin' ? '' : 'flex'}`} id="erp-master-view">
      
      {/* SIDE NAVIGATION - Hidden for public booking, login, and guest pages,
          and while the session is being verified (avoids a nav flash before the
          /login redirect on protected routes) */}
      {showAppChrome && (
        <SideNavigation
          activeDept={activeDept}
          activeDeptLabel={DEPARTMENT_BY_KEY[activeDept]?.label ?? activeDept}
          currentUser={currentUser}
          collapsed={navCollapsed}
          onToggleCollapse={() => setNavCollapsed(!navCollapsed)}
          subItems={subNavItems}
          activeSubItem={activeSubItem}
          onSubItemClick={handleSubItemClick}
          notifications={notifications}
          unreadNotifCount={getUnreadNotifCount()}
          onToggleNotifications={() => setShowNotifications(!showNotifications)}
          showNotifications={showNotifications}
          onMarkNotificationRead={markNotificationRead}
          onClearNotification={clearNotification}
          accentClass={activeAccentClass}
        />
      )}

      {/* GLOBAL HEADER - Full width, only visible on mouse hover. Hidden for public booking, login, and guest pages */}
      {showAppChrome && (
        <>
          {/* Hover trigger zone at top of screen */}
          <div
            className="fixed top-0 left-0 right-0 h-3 z-50"
            onMouseEnter={() => setHeaderVisible(true)}
          />
          <header
            onMouseEnter={() => setHeaderVisible(true)}
            onMouseLeave={() => setHeaderVisible(false)}
            className={`bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 py-3 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 fixed top-0 left-0 right-0 z-50 transition-transform duration-300 ${headerVisible ? 'translate-y-0' : '-translate-y-full'}`}
          >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-extrabold font-sans shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 transition-all duration-300">S</div>
            <div>
              <span className="font-sans font-extrabold text-sm tracking-tight text-slate-900 dark:text-white block">HOTEL ERP</span>
              <span className="text-[10px] font-mono text-indigo-600 uppercase tracking-widest leading-none block font-semibold">Live sync operational portal</span>
            </div>
          </div>

          {/* Global info controls */}
          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 cursor-pointer smooth-transition"
              title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>

            <div className="flex bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-0.5 text-[10px] font-mono font-bold tracking-tight shadow-sm">
              <button 
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1 rounded-lg transition-all duration-200 smooth-transition ${currency === 'USD' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                USD
              </button>
              <button 
                onClick={() => setCurrency('ETB')}
                className={`px-3 py-1 rounded-lg transition-all duration-200 smooth-transition ${currency === 'ETB' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                ETB
              </button>
            </div>
            
            <div className="text-right text-xs text-slate-600 dark:text-slate-400 font-sans hidden md:block leading-tight">
              <div>Operating Date: <strong className="text-indigo-600 font-mono">{currentSystemDate}</strong></div>
              <div className="text-[11px] text-slate-500 dark:text-slate-500 font-mono">Occ: {stats.occupancyRate}% | Rev: <span className="text-emerald-600">{formatAmount(stats.totalRevenue)}</span></div>
            </div>

            {/* Department Switcher — Phase 4 */}
            {currentUser && location.pathname.startsWith('/erp') && (
              <DepartmentSwitcher
                currentUser={currentUser}
                activeSegment={erpPathMatch?.dept.urlSegment}
                moduleToggles={moduleToggles}
                hasModuleAccess={hasModuleAccess}
              />
            )}

            {/* Tenant Switcher — Super Admin Only */}
            {currentUser?.isSuperAdmin && currentUser?.availableTenants && currentUser.availableTenants.length > 1 && (
              <TenantSwitcher
                currentUser={currentUser}
                onTenantChange={(tenantId) => {
                  // Refresh user data after tenant switch
                  verifySession().then(updatedUser => {
                    if (updatedUser) setCurrentUser(updatedUser);
                  });
                }}
              />
            )}

            {/* Property Switcher */}
            {properties.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 hidden sm:block">Property</label>
                <select
                  value={currentPropertyId || ''}
                  onChange={(e) => setCurrentPropertyId(e.target.value || null)}
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-sans font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:border-indigo-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  <option value="">All Properties</option>
                  {properties.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.property_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Settings */}
            {currentUser && (
              <button
                onClick={() => navigate('/erp/settings')}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all cursor-pointer smooth-transition"
                title="Settings"
              >
                <Settings size={13} />
              </button>
            )}

            {/* Logout */}
            {currentUser && (
              <button
                onClick={handleLogout}
                className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-all cursor-pointer smooth-transition"
                title="Logout"
              >
                <LogOut size={13} />
              </button>
            )}
          </div>
        </header>
        </>
      )}

      {/* MAIN CONTENT AREA — wrapped in the active department's accent class
          on ERP routes so portal buttons adopt the department's signature color */}
      <div className={`flex-1 flex flex-col min-w-0 ${isErpRoute ? activeAccentClass : ''}`}>
        {/* RENDER CHOSEN COMPONENT PORTALS */}
        <Suspense fallback={<div className="flex-1 flex items-center justify-center min-h-[40vh] text-sm text-stone-400">Loading…</div>}>
        <Routes>
          <Route 
            path="/login" 
            element={
              !sessionChecked ? (
                <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-300 text-sm">Verifying secure session...</div>
              ) : (
                <LoginRoute onLoginSuccess={handleLoginSuccess} />
              )
            } 
          />
          <Route path="/booking" element={<BookingRedirect />} />
          <Route path="/public-portal" element={<PublicPortal />} />
          <Route path="/guest-portal" element={<Navigate to="/guest" replace />} />
          <Route path="/guest" element={<GuestPortal />} />
          <Route path="/guest/:tab" element={<GuestPortal />} />
          <Route 
            path="/pos/login" 
            element={<POSLoginRoute onLoginSuccess={handlePOSLoginSuccess} />}
          />
          <Route 
            path="/pos" 
            element={
              !posSessionChecked ? (
                <div className="min-h-screen flex items-center justify-center bg-slate-900">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
                </div>
              ) : !posUser ? (
                <Navigate to="/pos/login" replace />
              ) : (
                <POSPortal user={posUser} onLogout={handlePOSLogout} />
              )
            }
          />
          {/* Phase 3: nested route-driven ERP navigation */}
          <Route path="/erp" element={
            <ErpLayout
              sessionChecked={sessionChecked}
              currentUser={currentUser}
              mustChangePassword={mustChangePassword}
              onPasswordChanged={() => setMustChangePassword(false)}
            />
          }>
            <Route index element={<ErpIndexRedirect currentUser={currentUser} />} />
            <Route path=":department" element={
              <DepartmentRoute
                currentUser={currentUser}
                moduleToggles={moduleToggles}
                hasModuleAccess={hasModuleAccess}
              />
            } />
            <Route path=":department/:tab" element={
              <DepartmentRoute
                currentUser={currentUser}
                moduleToggles={moduleToggles}
                hasModuleAccess={hasModuleAccess}
              />
            } />
            <Route path="*" element={<ErpIndexRedirect currentUser={currentUser} />} />
          </Route>
          <Route path="/" element={<Navigate to="/public-portal" replace />} />
          {/* Standalone KDS Display — accessible at /kds */}
          <Route
            path="/kds"
            element={
              !sessionChecked ? (
                <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-300 text-sm">Verifying secure session...</div>
              ) : !currentUser ? (
                <Navigate to="/login?redirect=/kds" replace />
              ) : (
                <div className="min-h-screen bg-slate-950">
                  <KitchenDisplayModule standalone userName={currentUser.name} onExit={() => navigate(getDefaultErpPath(currentUser))} />
                </div>
              )
            }
          />
          {/* KDS Management — accessible at /kds-management */}
          <Route
            path="/kds-management"
            element={
              !sessionChecked ? (
                <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-300 text-sm">Verifying secure session...</div>
              ) : !currentUser ? (
                <Navigate to="/login?redirect=/kds-management" replace />
              ) : (
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                  <KDSInstanceManagement />
                </div>
              )
            }
          />
          {/* Super Admin Portal — accessible at /admin */}
          <Route
            path="/admin"
            element={
              !sessionChecked ? (
                <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-300 text-sm">Verifying secure session...</div>
              ) : !currentUser ? (
                <Navigate to="/login?redirect=/admin" replace />
              ) : !currentUser.isSuperAdmin ? (
                <Navigate to="/erp" replace />
              ) : (
                <SuperAdminPortal currentUser={currentUser} onLogout={handleLogout} />
              )
            }
          />
        </Routes>
        </Suspense>

        {printGuestForm && (
          <CheckInPrintModal data={printGuestForm} onClose={() => setPrintGuestForm(null)} />
        )}

        {printGroupForm && (
          <GroupCheckInPrintModal data={printGroupForm} onClose={() => setPrintGroupForm(null)} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary onError={(error, errorInfo) => console.error('App Error:', error, errorInfo)}>
      <AppProviders>
        <Routes>
          {/* Admin Portal - standalone route without ERP chrome */}
          <Route path="/admin" element={<AdminPortalWrapper />} />
          {/* All other routes use the main ERP layout */}
          <Route path="/*" element={<MasterHotelERP />} />
        </Routes>
      </AppProviders>
    </ErrorBoundary>
  );
}

// Wrapper component for admin portal that handles auth and renders standalone
function AdminPortalWrapper() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkSession = async () => {
      try {
        const user = await verifySession();
        setCurrentUser(user);
      } catch (error) {
        console.error('Session verification failed:', error);
      } finally {
        setSessionChecked(true);
      }
    };
    checkSession();
  }, []);

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 text-sm">
        Verifying secure session...
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login?redirect=/admin" replace />;
  }

  if (!currentUser.isSuperAdmin) {
    return <Navigate to="/erp" replace />;
  }

  return <SuperAdminPortal currentUser={currentUser} onLogout={async () => {
    await logout();
    navigate('/login');
  }} />;
}

