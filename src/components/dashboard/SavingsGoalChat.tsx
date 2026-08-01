import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCompactINR } from "@/lib/currency";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  from: "acounted" | "user";
  text: string;
  chips?: string[];
  input?: boolean;       // show text input on this step
  isTyping?: boolean;    // shows typing bubble
}

interface SavingsGoalChatProps {
  open: boolean;
  onClose: () => void;
  onGoalCreated: (goal: { name: string; amount: number; months: number }) => void;
  suggestedMonthlyExpenses?: number; // from user's actual data
}

// ── Typing bubble ──────────────────────────────────────────────────────────────
const TypingBubble = () => (
  <div className="flex items-end gap-2">
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-sm shrink-0">
      🎯
    </div>
    <div className="bg-background border border-border/60 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
      <div className="flex gap-1 items-center h-4">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  </div>
);

// ── Acounted message bubble ────────────────────────────────────────────────────
const AccountedBubble = ({ text }: { text: string }) => (
  <motion.div
    className="flex items-end gap-2"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ type: "spring", stiffness: 260, damping: 24 }}
  >
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-sm shrink-0">
      🎯
    </div>
    <div className="bg-background border border-border/60 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm max-w-[78%]">
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </div>
  </motion.div>
);

// ── User message bubble ────────────────────────────────────────────────────────
const UserBubble = ({ text }: { text: string }) => (
  <motion.div
    className="flex justify-end"
    initial={{ opacity: 0, x: 10 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ type: "spring", stiffness: 260, damping: 24 }}
  >
    <div className="bg-primary rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[78%]">
      <p className="text-sm text-primary-foreground leading-relaxed">{text}</p>
    </div>
  </motion.div>
);

// ── Chip row ──────────────────────────────────────────────────────────────────
const ChipRow = ({ chips, onSelect, disabled }: { chips: string[]; onSelect: (c: string) => void; disabled: boolean }) => (
  <motion.div
    className="flex flex-wrap gap-2 pl-9"
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.15 }}
  >
    {chips.map(chip => (
      <motion.button
        key={chip}
        onClick={() => !disabled && onSelect(chip)}
        disabled={disabled}
        whileTap={{ scale: 0.94 }}
        className={cn(
          "px-3 py-1.5 rounded-full border text-xs font-medium transition-all pointer-events-auto",
          disabled
            ? "opacity-40 cursor-default bg-background border-border/40 text-muted-foreground"
            : "bg-primary/8 border-primary/30 text-primary hover:bg-primary/15 active:scale-95"
        )}
      >
        {chip}
      </motion.button>
    ))}
  </motion.div>
);

// ── Main chat modal ────────────────────────────────────────────────────────────
export const SavingsGoalChat = ({
  open, onClose, onGoalCreated, suggestedMonthlyExpenses = 0,
}: SavingsGoalChatProps) => {
  const TYPING_DELAY = 900;

  // Conversation state machine
  const [step,       setStep]       = useState<"what" | "how_much" | "when" | "done">("what");
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [isTyping,   setIsTyping]   = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [chipsDone,  setChipsDone]  = useState(false); // lock chips after selection
  const [goal,       setGoal]       = useState<{ name: string; amount: number; months: number }>({ name: "", amount: 0, months: 0 });
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  const GOAL_CHIPS    = ["✈️ Trip", "🛡️ Emergency fund", "💻 Gadget", "🏠 Down payment", "💒 Wedding", "🎓 Education", "✍️ Something else"];
  const WHEN_CHIPS    = ["3 months", "6 months", "1 year", "2 years"];

  const addMessage = (msg: Omit<Message, "id">) =>
    setMessages(p => [...p, { ...msg, id: Math.random().toString(36).slice(2) }]);

  const typeAndAdd = async (text: string, chips?: string[], withInput?: boolean) => {
    setIsTyping(true);
    await new Promise(r => setTimeout(r, TYPING_DELAY));
    setIsTyping(false);
    addMessage({ from: "acounted", text, chips, input: withInput });
  };

  // Init conversation on open
  useEffect(() => {
    if (!open) return;
    setStep("what");
    setMessages([]);
    setIsTyping(false);
    setInputValue("");
    setChipsDone(false);
    setGoal({ name: "", amount: 0, months: 0 });
    setTimeout(() => {
      typeAndAdd(
        "What are you saving for? Pick one or type your own.",
        GOAL_CHIPS
      );
    }, 300);
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ── Handle chip / input response ──────────────────────────────────────────
  const handleUserReply = async (text: string) => {
    if (!text.trim()) return;
    setChipsDone(true);
    setInputValue("");

    addMessage({ from: "user", text: text.trim() });

    if (step === "what") {
      const cleanName = text.replace(/^[^\w\s]+/, "").trim(); // strip emoji prefix
      setGoal(p => ({ ...p, name: cleanName }));
      setStep("how_much");

      // Contextual suggestion based on goal type
      const lower = text.toLowerCase();
      let suggestion = "";
      if (lower.includes("emergency")) {
        const lo = Math.round(suggestedMonthlyExpenses * 3 / 1000) * 1000 || 45000;
        const hi = lo * 2;
        suggestion = `Emergency funds are usually 3–6 months of expenses. For you that's around ${formatCompactINR(lo)}–${formatCompactINR(hi)}.`;
      } else if (lower.includes("trip")) {
        suggestion = "A decent trip usually costs ₹20,000–₹80,000 depending on where you're going.";
      } else if (lower.includes("down payment") || lower.includes("home")) {
        suggestion = "Down payments are typically 10–20% of the property value. Even ₹3,00,000 is a great start.";
      } else if (lower.includes("gadget")) {
        suggestion = "Most gadgets fall between ₹30,000–₹1,50,000. What are you eyeing?";
      } else {
        suggestion = "Got it.";
      }

      await typeAndAdd(`${suggestion} How much do you need?`, undefined, true);
      setTimeout(() => inputRef.current?.focus(), 100);

    } else if (step === "how_much") {
      const amt = parseInt(text.replace(/[^0-9]/g, ""));
      if (!amt || amt < 100) {
        await typeAndAdd("Let's try a number — like ₹50000 or 50k.");
        setChipsDone(false);
        return;
      }
      setGoal(p => ({ ...p, amount: amt }));
      setStep("when");
      await typeAndAdd("When do you want to hit this goal?", WHEN_CHIPS);

    } else if (step === "when") {
      const monthMap: Record<string, number> = {
        "3 months": 3, "6 months": 6, "1 year": 12, "2 years": 24,
      };
      const months = monthMap[text] || parseInt(text) || 12;
      setGoal(p => ({ ...p, months }));
      setStep("done");

      const finalGoal = { ...goal, months };
      const monthly = Math.ceil(finalGoal.amount / months);
      await typeAndAdd(
        `Done! That's ${formatCompactINR(monthly)}/month — very doable. Your goal is set. 🎉`
      );
      await new Promise(r => setTimeout(r, 1200));
      onGoalCreated({ name: goal.name, amount: goal.amount, months });
      setTimeout(onClose, 600);
    }
  };

  const handleSend = () => {
    if (inputValue.trim()) handleUserReply(inputValue.trim());
  };

  // Active chips = most recent acounted message's chips, only if not done
  const lastAccountedMsg = [...messages].reverse().find(m => m.from === "acounted" && m.chips);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm w-[calc(100%-2rem)] p-0 overflow-hidden [grid-template-columns:minmax(0,1fr)] border-0 shadow-2xl">

        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-violet-500 px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">
              🎯
            </div>
            <div>
              <p className="text-sm font-bold text-white">Acounted</p>
              <p className="text-[10px] text-white/70">Let's build your first goal</p>
            </div>
          </div>
          <button onClick={onClose} className="pointer-events-auto text-white/60 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chat body */}
        <div className="flex flex-col gap-3 p-4 max-h-[55vh] overflow-y-auto bg-muted/20">
          <AnimatePresence>
            {messages.map((msg, idx) => (
              <div key={msg.id}>
                {msg.from === "acounted"
                  ? <AccountedBubble text={msg.text} />
                  : <UserBubble text={msg.text} />
                }
                {/* Show chips for this message if it's the last acounted msg and chips not done */}
                {msg.from === "acounted" && msg.chips && msg === lastAccountedMsg && !chipsDone && (
                  <div className="mt-2">
                    <ChipRow chips={msg.chips} onSelect={handleUserReply} disabled={chipsDone} />
                  </div>
                )}
              </div>
            ))}
          </AnimatePresence>
          {isTyping && <TypingBubble />}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {(step === "how_much" || (step === "what" && !chipsDone)) && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border/40 bg-background">
            <input
              ref={inputRef}
              type={step === "how_much" ? "number" : "text"}
              placeholder={step === "how_much" ? "e.g. 50000" : "Type here…"}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              className="flex-1 bg-muted/40 rounded-full px-4 py-2 text-sm outline-none border border-border/40 focus:border-primary/40 pointer-events-auto text-foreground placeholder:text-muted-foreground/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <motion.button
              onClick={handleSend}
              whileTap={{ scale: 0.9 }}
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center pointer-events-auto shrink-0"
            >
              <Send className="h-4 w-4 text-white" />
            </motion.button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
};
