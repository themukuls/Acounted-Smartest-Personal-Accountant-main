import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowRight, Shield, TrendingUp, Target, Users, Lightbulb, Share, Plus, Smartphone, Wallet, Receipt } from "lucide-react";
import { useDeviceDetection } from "@/hooks/use-device-detection";
import { useAPKInstall } from "@/contexts/APKInstallContext";

const IOSInstallSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <Sheet open={open} onOpenChange={onClose}>
    <SheetContent side="bottom" className="rounded-t-2xl pb-8">
      <SheetHeader className="mb-4">
        <SheetTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          Install on your iPhone
        </SheetTitle>
      </SheetHeader>
      <ol className="space-y-4">
        <li className="flex items-start gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">1</span>
          <span className="text-sm text-foreground pt-1">
            Tap the <Share className="inline h-4 w-4 text-blue-500 mx-0.5" /> <strong>Share</strong> button at the bottom of Safari
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">2</span>
          <span className="text-sm text-foreground pt-1">
            Scroll down and tap <strong>"Add to Home Screen"</strong> <Plus className="inline h-4 w-4 text-blue-500 mx-0.5" />
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">3</span>
          <span className="text-sm text-foreground pt-1">
            Tap <strong>"Add"</strong> in the top right corner to confirm
          </span>
        </li>
      </ol>
      <p className="text-xs text-muted-foreground mt-5 text-center">
        Open Acounted from your home screen for the best experience
      </p>
    </SheetContent>
  </Sheet>
);

const MobileInstallPage = () => {
  const { isAndroid } = useDeviceDetection();
  const { triggerAPKDownload } = useAPKInstall();
  const [showIOSSheet, setShowIOSSheet] = useState(false);

  const handleInstall = () => {
    if (isAndroid) {
      triggerAPKDownload();
    } else {
      setShowIOSSheet(true);
    }
  };

  return (
    <div className="page-safe min-h-screen bg-gradient-to-br from-white via-white/95 to-primary/5">
      <IOSInstallSheet open={showIOSSheet} onClose={() => setShowIOSSheet(false)} />

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <img
                src="/app-assets/acounted-logo.png"
                alt="Acounted"
                className="h-10 w-auto"
              />
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-foreground hover:text-primary transition-colors pointer-events-auto">Features</a>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground pointer-events-auto" onClick={handleInstall}>
                Install app
              </Button>
            </div>

            {/* Mobile Navigation */}
            <div className="flex md:hidden items-center space-x-3">
              <Button size="sm" className="bg-gradient-primary text-primary-foreground text-xs px-3 pointer-events-auto" onClick={handleInstall}>
                Install app
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-24 lg:pt-32 pb-10 lg:pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                Your Personal <span className="gradient-text">Accountant</span>, Built for Privacy.
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl">
                Expenses, budgets, warranties, IOUs — everything about your money, in one place. Stored only on your device. Built for India.
              </p>
              <div className="flex gap-4">
                <Button size="lg" className="bg-gradient-primary text-primary-foreground pointer-events-auto" onClick={handleInstall}>
                  Install app <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <a
                  href="https://www.youtube.com/watch?v=L3wKzyIN1yk&list=RDL3wKzyIN1yk&start_radio=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto"
                >
                  <Button variant="outline" size="lg" className="pointer-events-auto">
                    Watch demo
                  </Button>
                </a>
              </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-2 gap-4">
              {/* Entries tracked */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <Receipt className="h-4 w-4 text-green-600" />
                  </div>
                  <span className="text-xs font-medium text-green-700">Entries Tracked</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">1,240</div>
                <div className="flex items-center gap-1 mt-1">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  <span className="text-xs text-green-600">Always ready to review</span>
                </div>
              </div>

              {/* Savings Goal */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Target className="h-4 w-4 text-blue-600" />
                  </div>
                  <span className="text-xs font-medium text-blue-700">Savings Goal</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">75%</div>
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 w-[75%] rounded-full" />
                  </div>
                  <span className="text-xs text-muted-foreground">₹75,000 of ₹1,00,000</span>
                </div>
              </div>

              {/* Monthly Budget */}
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
                    <Wallet className="h-4 w-4 text-violet-600" />
                  </div>
                  <span className="text-xs font-medium text-violet-700">Monthly Budget</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">On Track</div>
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 bg-violet-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 w-[71%] rounded-full" />
                  </div>
                  <span className="text-xs text-muted-foreground">₹32,000 of ₹45,000 spent</span>
                </div>
              </div>

              {/* Investments */}
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-amber-600" />
                  </div>
                  <span className="text-xs font-medium text-amber-700">Investments</span>
                </div>
                <div className="text-2xl font-bold text-gray-900">+12.5%</div>
                <div className="mt-1 space-y-0.5">
                  <div className="text-xs text-muted-foreground">ELSS Mutual Funds</div>
                  <div className="text-xs text-green-600 font-medium">Long-term growth</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 lg:py-20 px-4 sm:px-6 lg:px-8 bg-white/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Your Financial Journey, <span className="gradient-text">Secured & Simplified</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From salary to side income, EMIs to warranties — Acounted handles what other apps ignore.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                <Shield className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Privacy-First Design</h3>
              <p className="text-sm text-muted-foreground">Your financial data is stored locally on your device, never tracked or shared.</p>
            </div>

            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                <Users className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Built for Every Indian Earner</h3>
              <p className="text-sm text-muted-foreground">Whether you're salaried, a freelancer, business owner, or investor — Acounted keeps your income and spending organized.</p>
            </div>

            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                <Lightbulb className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Personalized AI Insights</h3>
              <p className="text-sm text-muted-foreground">Get smart recommendations for budgeting, savings, and investments, tailored just for you.</p>
            </div>

            <div className="glass-card p-6 text-center">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                <Receipt className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Automatic Expense Capture</h3>
              <p className="text-sm text-muted-foreground">Review detected payments quickly, with remembered categories for repeat merchants.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 lg:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
            Ready to take control of your <span className="gradient-text">financial future?</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Your money deserves a better memory. Start for free today.
          </p>
          <Button size="lg" className="bg-gradient-primary text-primary-foreground pointer-events-auto" onClick={handleInstall}>
            Install app <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
};

export default MobileInstallPage;
