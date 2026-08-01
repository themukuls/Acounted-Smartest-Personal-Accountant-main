import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import {
  Calculator,
  PiggyBank,
  CreditCard,
  Target,
  Mail,
  HandCoins,
  Archive,
  Sparkles,
  Repeat,
} from "lucide-react";
import { NotificationBadge } from "@/components/notifications/NotificationBadge";

const navigationItems = [
  { id: 'track-savings',    label: 'Dashboard',  icon: PiggyBank,   href: '/dashboard'        },
  { id: 'create-budget',    label: 'Budget',     icon: Target,      href: '/budget'           },
  { id: 'expense-tracker',  label: 'Expenses',   icon: CreditCard,  href: '/expenses'         },
  // Gets its own row here (unlike the mobile nav, which is out of space) —
  // a vertical sidebar has room, and it makes the feature discoverable to
  // desktop users who never see the Expenses page's summary card.
  { id: 'subscriptions',    label: 'Subscriptions', icon: Repeat,   href: '/subscriptions'    },
  { id: 'tax-copilot',      label: 'Tax Copilot', icon: Sparkles,   href: '/tax-copilot'      },
  { id: 'udhar-tracker',    label: 'Lendr',      icon: HandCoins,   href: '/udhar-tracker'    },
  { id: 'recall',           label: 'Recall',     icon: Archive,     href: '/recall'           },
  { id: 'contact',          label: 'Contact',    icon: Mail,        href: '/contact'          },
];

// Sub-routes that belong to a parent nav item — keeps the correct item
// highlighted when the user navigates to a tax sub-page etc.
const ROUTE_FAMILIES: Record<string, string[]> = {
  '/dashboard': ['/dashboard', '/track-savings', '/income-setup'],
  '/budget':    ['/budget'],
  '/expenses':  ['/expenses'],
  '/subscriptions': ['/subscriptions'],
  '/tax-copilot': [
    '/tax-copilot', '/tax-optimization', '/tax-assistant',
    '/tax-planner-ai', '/tax-calendar',
    '/advance-tax', '/capital-gains',
    '/salary-restructuring', '/itr-readiness', '/tax-compliance',
  ],
  '/udhar-tracker': ['/udhar-tracker'],
  '/recall':    ['/recall'],
  '/contact':   ['/contact'],
};

interface DesktopSidebarProps {
  onOpenNotifications: () => void;
}

export const DesktopSidebar = ({ onOpenNotifications }: DesktopSidebarProps) => {
  const location = useLocation();

  const isActive = (href: string) => {
    const family = ROUTE_FAMILIES[href] ?? [href];
    return family.includes(location.pathname);
  };

  return (
    <div className="desktop-sidebar">
      <div className="mb-8">
        <Link to="/" className="flex items-center pointer-events-auto">
          <img
            src="/app-assets/acounted-logo.png"
            alt="Acounted"
            className="h-12 w-auto"
          />
        </Link>
      </div>

      <nav className="space-y-2">
        {navigationItems.map((item) => {
          const Icon   = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              to={item.href}
              className={cn(
                "glass-nav w-full text-left flex items-center gap-3 text-sm font-medium transition-all duration-300 pointer-events-auto",
                active
                  ? "bg-gradient-primary text-primary-foreground shadow-lg"
                  : "text-foreground hover:text-primary"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-6 left-6">
        <NotificationBadge onClick={onOpenNotifications} />
      </div>
    </div>
  );
};
