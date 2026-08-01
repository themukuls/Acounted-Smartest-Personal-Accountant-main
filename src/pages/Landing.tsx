import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, TrendingUp, Target, Calculator, Users, Lightbulb, Wallet, Receipt } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import { useRef, useEffect, useState } from "react";

// ── Count-up hook ─────────────────────────────────────────────────────────────
const useCountUp = (target: number, duration = 1600) => {
  const ref     = useRef(null);
  const inView  = useInView(ref, { once: true, margin: "-60px" });
  const [val, setVal] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      setVal(Math.round(target * (1 - Math.pow(1 - t, 4))));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView]);

  return { ref, val };
};

// ── Animated bar ──────────────────────────────────────────────────────────────
const AnimBar = ({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) => {
  const ref    = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <div ref={ref} className="h-1.5 rounded-full overflow-hidden bg-current/10" style={{ background: "inherit" }}>
      <div className={`h-1.5 ${color} rounded-full overflow-hidden`} style={{ background: "rgba(0,0,0,0.06)" }}>
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: "0%" }}
          animate={inView ? { width: `${pct}%` } : {}}
          transition={{ type: "spring", stiffness: 48, damping: 16, delay }}
        />
      </div>
    </div>
  );
};

// ── Scroll reveal ─────────────────────────────────────────────────────────────
const Reveal = ({ children, delay = 0, className }: {
  children: React.ReactNode; delay?: number; className?: string;
}) => {
  const ref    = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay }}
    >
      {children}
    </motion.div>
  );
};

// ── Bento card wrapper ────────────────────────────────────────────────────────
const BentoCard = ({ children, className, delay = 0 }: {
  children: React.ReactNode; className?: string; delay?: number;
}) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 28, scale: 0.96 }}
    animate={{ opacity: 1, y: 0,  scale: 1    }}
    transition={{ type: "spring", stiffness: 260, damping: 26, delay }}
    whileHover={{ y: -4, boxShadow: "0 16px 40px rgba(0,0,0,0.10)", transition: { duration: 0.2 } }}
  >
    {children}
  </motion.div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
const Landing = () => {
  // Tax saved count-up
  const { ref: taxRef, val: taxVal } = useCountUp(124000, 1800);

  return (
    <div className="page-safe min-h-screen bg-gradient-to-br from-background via-background/95 to-primary/5">

      {/* Navigation */}
      <motion.nav
        className="fixed-top-safe fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-white/20"
        initial={{ y: -64, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.05 }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <img src="/app-assets/acounted-logo.png" alt="Acounted" className="h-10 w-auto" />
            </div>

            {/* Desktop */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-foreground hover:text-primary transition-colors pointer-events-auto">Features</a>
              <Link to="/auth?mode=login">
                <Button variant="outline" size="sm" className="pointer-events-auto">Log in</Button>
              </Link>
              <Link to="/auth">
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                  <Button size="sm" className="bg-gradient-primary text-primary-foreground pointer-events-auto">
                    Get started
                  </Button>
                </motion.div>
              </Link>
            </div>

            {/* Mobile */}
            <div className="flex md:hidden items-center space-x-3">
              <Link to="/auth?mode=login">
                <Button variant="outline" size="sm" className="text-xs px-3 pointer-events-auto">Log in</Button>
              </Link>
              <Link to="/auth">
                <Button size="sm" className="bg-gradient-primary text-primary-foreground text-xs px-3 pointer-events-auto">
                  Get started
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section className="pt-24 lg:pt-32 pb-10 lg:pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left copy */}
            <div className="space-y-8">
              <motion.h1
                className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight"
                initial={{ opacity: 0, y: 32 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.12 }}
              >
                Your Personal{" "}
                <motion.span
                  className="gradient-text"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.24 }}
                >
                  Accountant
                </motion.span>
                , Built for Privacy.
              </motion.h1>

              {/* Updated sub-text */}
              <motion.p
                className="text-lg text-muted-foreground max-w-xl"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.34 }}
              >
                Taxes, salary, savings, investments — all of it, finally making sense.
                No bank links, no data shared, no guesswork.
                Just you, your money, and clarity.
              </motion.p>

              <motion.div
                className="flex gap-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 26, delay: 0.44 }}
              >
                <Link to="/auth">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Button size="lg" className="bg-gradient-primary text-primary-foreground pointer-events-auto shadow-lg shadow-primary/20">
                      Sign up <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </motion.div>
                </Link>
                <a
                  href="https://www.youtube.com/watch?v=L3wKzyIN1yk&list=RDL3wKzyIN1yk&start_radio=1"
                  target="_blank" rel="noopener noreferrer"
                  className="pointer-events-auto"
                >
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Button variant="outline" size="lg" className="pointer-events-auto">Watch demo</Button>
                  </motion.div>
                </a>
              </motion.div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-2 gap-4">

              {/* Tax Saved — count-up */}
              <BentoCard delay={0.2}
                className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-5 shadow-sm cursor-default">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <Receipt className="h-4 w-4 text-green-600" />
                  </div>
                  <span className="text-xs font-medium text-green-700">Tax Saved</span>
                </div>
                <div ref={taxRef} className="text-2xl font-bold text-gray-900">
                  ₹{taxVal.toLocaleString("en-IN")}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
                  <span className="text-xs text-green-600">₹24,000 more than last year</span>
                </div>
              </BentoCard>

              {/* Savings Goal — animated bar */}
              <BentoCard delay={0.28}
                className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 shadow-sm cursor-default">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Target className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-xs font-medium text-blue-700">Savings Goal</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">75%</div>
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-500 rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: "75%" }}
                      transition={{ type: "spring", stiffness: 48, damping: 16, delay: 0.7 }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">₹75,000 of ₹1,00,000</span>
                </div>
              </BentoCard>

              {/* Monthly Budget — animated bar */}
              <BentoCard delay={0.36}
                className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-2xl p-5 shadow-sm cursor-default">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                    <Wallet className="h-4 w-4 text-violet-600" />
                  </div>
                  <span className="text-xs font-medium text-violet-700">Monthly Budget</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">On Track</div>
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 bg-violet-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-violet-500 rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: "71%" }}
                      transition={{ type: "spring", stiffness: 48, damping: 16, delay: 0.85 }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">₹32,000 of ₹45,000 spent</span>
                </div>
              </BentoCard>

              {/* Investments */}
              <BentoCard delay={0.44}
                className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-5 shadow-sm cursor-default">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-amber-600" />
                  </div>
                  <span className="text-xs font-medium text-amber-700">Investments</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">+12.5%</div>
                <div className="mt-1 space-y-0.5">
                  <div className="text-xs text-muted-foreground">ELSS Mutual Funds</div>
                  <div className="text-xs text-green-600 font-medium">Tax-saving instrument</div>
                </div>
              </BentoCard>

            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 lg:py-20 px-4 sm:px-6 lg:px-8 bg-white/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto">

          <Reveal className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Built for how Indians <span className="gradient-text">actually manage money</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From salary to side income, EMIs to warranties — Acounted handles what other apps ignore.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { icon: Shield,     delay: 0.0, title: "Privacy-First Design",         body: "Your financial data is stored locally on your device, never tracked or shared." },
              { icon: Users,      delay: 0.1, title: "Built for Every Indian Earner", body: "Whether you're salaried, a freelancer, business owner, or investor — Acounted understands your income, your deductions, and your tax situation." },
              { icon: Lightbulb,  delay: 0.2, title: "Personalized AI Insights",     body: "Get smart recommendations for budgeting, savings, and investments, tailored just for you." },
              { icon: Calculator, delay: 0.3, title: "Effortless Tax Planning",       body: "Maximize your tax savings with AI-powered planning and easy filing assistance." },
            ].map(({ icon: Icon, delay, title, body }) => (
              <Reveal key={title} delay={delay}>
                <motion.div
                  className="glass-card p-6 text-center h-full"
                  whileHover={{ y: -5, boxShadow: "0 20px 48px rgba(0,0,0,0.10)", transition: { duration: 0.2 } }}
                >
                  <div className="w-12 h-12 bg-gradient-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                    <Icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
              Ready to take control of your <span className="gradient-text">financial future?</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              Your money deserves a better memory. Start for free today.
            </p>
            <Link to="/auth">
              <motion.div className="inline-block" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                <Button size="lg" className="bg-gradient-primary text-primary-foreground pointer-events-auto shadow-lg shadow-primary/20">
                  Get started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </motion.div>
            </Link>
          </Reveal>
        </div>
      </section>

    </div>
  );
};

export default Landing;
