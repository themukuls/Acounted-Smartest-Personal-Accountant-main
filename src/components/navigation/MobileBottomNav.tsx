import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import {
  CreditCard, Target, Calculator, HandCoins, Home, Archive, Sparkles,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "home",          label: "Home",     icon: Home,       href: "/dashboard"       },
  { id: "expenses",      label: "Expenses", icon: CreditCard, href: "/expenses"        },
  { id: "budget",        label: "Budget",   icon: Target,     href: "/budget"          },
  { id: "tax-copilot",   label: "Tax",      icon: Sparkles,   href: "/tax-copilot"     },
  { id: "udhar-tracker", label: "Lendr",    icon: HandCoins,  href: "/udhar-tracker"   },
  { id: "recall",        label: "Recall",   icon: Archive,    href: "/recall"          },
];

export const MobileBottomNav = () => {
  const location  = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Route families — sub-pages keep their parent nav item highlighted
  const ROUTE_FAMILIES: Record<string, string[]> = {
    "/dashboard": [
      "/dashboard", "/track-savings", "/income-setup",
    ],
    "/expenses": ["/expenses"],
    "/budget": [
      "/budget",
    ],
    "/tax-copilot": [
      "/tax-copilot", "/tax-optimization", "/tax-assistant",
      "/tax-planner-ai", "/tax-calendar",
      "/advance-tax", "/capital-gains",
      "/salary-restructuring", "/itr-readiness", "/tax-compliance",
    ],
    "/udhar-tracker": [
      "/udhar-tracker",
    ],
    "/recall": [
      "/recall",
    ],
  };

  const isActive = (href: string) => {
    const family = ROUTE_FAMILIES[href] ?? [href];
    return family.includes(location.pathname);
  };

  // Auto-scroll active item into view — only when the active NAV ITEM changes,
  // not on every sub-route change within the same section.
  const prevActiveRef = useRef<number>(-1);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const activeIdx = NAV_ITEMS.findIndex(item => isActive(item.href));
    if (activeIdx < 0) return;

    // Skip scroll if we're still on the same nav section — prevents jitter
    // when navigating between sub-pages (e.g. tax-planner → tax-calendar)
    if (activeIdx === prevActiveRef.current) return;
    prevActiveRef.current = activeIdx;

    // Use actual DOM element position for accuracy instead of estimated width
    const items = container.querySelectorAll("a");
    const activeEl = items[activeIdx] as HTMLElement | undefined;
    if (!activeEl) return;

    const targetScroll = activeEl.offsetLeft - container.clientWidth / 2 + activeEl.offsetWidth / 2;
    container.scrollTo({ left: Math.max(0, targetScroll), behavior: "smooth" });
  }, [location.pathname]);

  return (
    <div className="mobile-nav">
      <div
        ref={scrollRef}
        style={{
          display:               "flex",
          overflowX:             "auto",
          overflowY:             "hidden",
          scrollbarWidth:        "none",       // Firefox
          WebkitOverflowScrolling: "touch",
          scrollSnapType:        "x mandatory",
          overscrollBehaviorX:   "contain",
          msOverflowStyle:       "none",       // IE/Edge
          borderRadius:          24,
          paddingTop:            6,
          paddingBottom:         6,
        }}
      >
        {/* Hide scrollbar in WebKit */}
        <style>{`
          .mobile-nav > div::-webkit-scrollbar { display: none; }
        `}</style>

        {NAV_ITEMS.map(item => {
          const active = isActive(item.href);
          const Icon   = item.icon;
          return (
            <Link
              key={item.id}
              to={item.href}
              style={{
                flex:           "0 0 72px",
                scrollSnapAlign:"start",
                display:        "flex",
                flexDirection:  "column",
                alignItems:     "center",
                justifyContent: "center",
                gap:            4,
                paddingTop:     6,
                paddingBottom:  6,
                textDecoration: "none",
              }}
              className="pointer-events-auto transition-all duration-200 group"
            >
              {/* Icon pill */}
              <div className={cn(
                "flex items-center justify-center w-10 h-9 rounded-xl transition-all duration-200",
                active ? "bg-primary/10 shadow-sm" : "group-hover:bg-muted/60"
              )}>
                <Icon
                  strokeWidth={active ? 2.5 : 1.8}
                  className={cn(
                    "w-5 h-5 transition-all duration-200",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
              </div>

              {/* Label */}
              <span className={cn(
                "text-[10px] leading-none transition-colors duration-200 font-medium",
                active ? "text-primary font-semibold" : "text-muted-foreground"
              )}>
                {item.label}
              </span>

              {/* Active dot */}
              <span className={cn(
                "block h-1 w-1 rounded-full transition-all duration-300",
                active ? "bg-primary scale-100" : "scale-0 bg-transparent"
              )} />
            </Link>
          );
        })}
      </div>
    </div>
  );
};
