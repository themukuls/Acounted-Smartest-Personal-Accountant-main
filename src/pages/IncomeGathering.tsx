import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Trash2, 
  Banknote, 
  Home, 
  Laptop, 
  Tractor, 
  TrendingUp, 
  Target,
  CreditCard,
  ArrowRight,
  PieChart
} from "lucide-react";
import { Link } from "react-router-dom";

interface IncomeSource {
  id: string;
  type: string;
  amount: string;
  name: string;
}

interface Expense {
  id: string;
  type: string;
  amount: string;
  name: string;
  frequency: 'monthly' | 'annually';
}

interface Investment {
  id: string;
  type: string;
  amount: string;
  name: string;
}

const IncomeGathering = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([
    { id: '1', type: 'salary', amount: '', name: 'Primary Salary' }
  ]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  

  const incomeTypes = [
    { value: 'salary', label: 'Salary', icon: Banknote },
    { value: 'rental', label: 'Rental Income', icon: Home },
    { value: 'freelancing', label: 'Freelancing', icon: Laptop },
    { value: 'farming', label: 'Farming', icon: Tractor },
    { value: 'business', label: 'Business', icon: TrendingUp },
    { value: 'other', label: 'Other', icon: Plus }
  ];

  const expenseTypes = [
    { value: 'rent', label: 'Rent' },
    { value: 'emi', label: 'EMI' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'groceries', label: 'Groceries' },
    { value: 'transport', label: 'Transportation' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'medical', label: 'Medical Bills' },
    { value: 'other', label: 'Other' }
  ];

  const investmentTypes = [
    { value: 'sip', label: 'SIP' },
    { value: 'mutual_funds', label: 'Mutual Funds' },
    { value: 'stocks', label: 'Stocks' },
    { value: 'fd', label: 'Fixed Deposit' },
    { value: 'ppf', label: 'PPF' },
    { value: 'nps', label: 'NPS' },
    { value: 'elss', label: 'ELSS' },
    { value: 'other', label: 'Other' }
  ];

  const addIncomeSource = () => {
    const newSource: IncomeSource = {
      id: Date.now().toString(),
      type: 'salary',
      amount: '',
      name: ''
    };
    setIncomeSources([...incomeSources, newSource]);
  };

  const removeIncomeSource = (id: string) => {
    setIncomeSources(incomeSources.filter(source => source.id !== id));
  };

  const updateIncomeSource = (id: string, field: keyof IncomeSource, value: string) => {
    setIncomeSources(sources => 
      sources.map(source => 
        source.id === id ? { ...source, [field]: value } : source
      )
    );
  };

  const addExpense = () => {
    const newExpense: Expense = {
      id: Date.now().toString(),
      type: 'rent',
      amount: '',
      name: '',
      frequency: 'monthly'
    };
    setExpenses([...expenses, newExpense]);
  };

  const removeExpense = (id: string) => {
    setExpenses(expenses.filter(expense => expense.id !== id));
  };

  const updateExpense = (id: string, field: keyof Expense, value: string) => {
    setExpenses(expenses => 
      expenses.map(expense => 
        expense.id === id ? { ...expense, [field]: value } : expense
      )
    );
  };

  const addInvestment = () => {
    const newInvestment: Investment = {
      id: Date.now().toString(),
      type: 'sip',
      amount: '',
      name: ''
    };
    setInvestments([...investments, newInvestment]);
  };

  const removeInvestment = (id: string) => {
    setInvestments(investments.filter(investment => investment.id !== id));
  };

  const updateInvestment = (id: string, field: keyof Investment, value: string) => {
    setInvestments(investments => 
      investments.map(investment => 
        investment.id === id ? { ...investment, [field]: value } : investment
      )
    );
  };

  const nextStep = () => {
    if (currentStep < 3) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  return (
    <div className="page-safe min-h-screen bg-gradient-to-br from-background via-background/95 to-primary/5">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-white/20">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="pointer-events-auto">
              <img 
                src="/app-assets/acounted-logo.png" 
                alt="Acounted" 
                className="h-12 w-auto"
              />
            </Link>
          </div>
          {/* Mobile intro text */}
          <div className="md:hidden mt-4 text-center">
            <p className="text-sm text-muted-foreground mb-4">Let's begin by getting your basic details</p>
            
            {/* 3D Separator */}
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gradient-to-r from-transparent via-primary/20 to-transparent"></div>
              </div>
              <div className="relative flex justify-center">
                <div className="bg-white px-2">
                  <div className="h-2 w-2 rounded-full bg-primary/30 shadow-lg"></div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-center gap-2 text-xs bg-gradient-to-r from-primary/5 to-secondary/5 rounded-lg p-3 shadow-sm">
              <span className="bg-primary/10 px-2 py-1 rounded">1. Income</span>
              <ArrowRight className="h-3 w-3 text-primary" />
              <span className="bg-primary/10 px-2 py-1 rounded">2. Expenses</span>
              <ArrowRight className="h-3 w-3 text-primary" />
              <span className="bg-primary/10 px-2 py-1 rounded">3. Investments</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        {/* Progress Steps - Desktop only */}
        <div className="hidden md:block mb-6 md:mb-8">
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= step 
                    ? 'bg-gradient-primary text-primary-foreground' 
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {step}
                </div>
                <span className={`text-xs md:text-sm font-medium ${
                  currentStep >= step ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {step === 1 ? 'Income Sources' : step === 2 ? 'Expenses' : 'Investments'}
                </span>
                {step < 3 && <ArrowRight className="hidden md:block h-4 w-4 text-muted-foreground ml-4" />}
              </div>
            ))}
          </div>
        </div>

        <Tabs value={currentStep.toString()} className="space-y-4 md:space-y-6">
          {/* Step 1: Income Sources */}
          <TabsContent value="1" className="space-y-4 md:space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <Banknote className="h-5 w-5" />
                  Tell us about your income sources
                </CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Add all your income sources to get accurate tax planning suggestions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {incomeSources.map((source, index) => (
                  <div key={source.id} className="grid grid-cols-1 gap-4 p-4 rounded-lg border bg-card">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor={`type-${source.id}`} className="text-xs md:text-sm">Income Type</Label>
                        <Select 
                          value={source.type} 
                          onValueChange={(value) => updateIncomeSource(source.id, 'type', value)}
                        >
                          <SelectTrigger className="h-9 md:h-10 pointer-events-auto">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {incomeTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                <div className="flex items-center gap-2">
                                  <type.icon className="h-4 w-4" />
                                  {type.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label htmlFor={`name-${source.id}`} className="text-xs md:text-sm">Source Name</Label>
                        <Input
                          id={`name-${source.id}`}
                          value={source.name}
                          onChange={(e) => updateIncomeSource(source.id, 'name', e.target.value)}
                          placeholder="e.g., Company XYZ"
                          className="h-9 md:h-10 text-sm pointer-events-auto"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor={`amount-${source.id}`} className="text-xs md:text-sm">Monthly Amount (₹)</Label>
                        <Input
                          id={`amount-${source.id}`}
                          type="number"
                          value={source.amount}
                          onChange={(e) => updateIncomeSource(source.id, 'amount', e.target.value)}
                          placeholder="50000"
                          className="h-9 md:h-10 text-sm pointer-events-auto"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      {index === 0 && (
                        <Badge variant="secondary" className="px-2 py-1 text-xs">Primary</Badge>
                      )}
                      {index > 0 && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeIncomeSource(source.id)}
                          className="ml-auto pointer-events-auto"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                
                <Button variant="outline" onClick={addIncomeSource} className="w-full h-10 md:h-11 pointer-events-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add More Income Source
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Step 2: Expenses */}
          <TabsContent value="2" className="space-y-4 md:space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <CreditCard className="h-5 w-5" />
                  Track your fixed expenses
                </CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Understanding your expenses helps us suggest better budgeting strategies
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {expenses.length === 0 ? (
                  <div className="text-center py-6 md:py-8 text-muted-foreground">
                    <CreditCard className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">No expenses added yet. Click below to add your first expense.</p>
                  </div>
                ) : (
                  expenses.map((expense) => (
                    <div key={expense.id} className="grid grid-cols-1 gap-4 p-4 rounded-lg border bg-card">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <Label htmlFor={`expense-type-${expense.id}`} className="text-xs md:text-sm">Expense Type</Label>
                          <Select 
                            value={expense.type} 
                            onValueChange={(value) => updateExpense(expense.id, 'type', value)}
                          >
                            <SelectTrigger className="h-9 md:h-10 pointer-events-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {expenseTypes.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor={`expense-name-${expense.id}`} className="text-xs md:text-sm">Description</Label>
                          <Input
                            id={`expense-name-${expense.id}`}
                            value={expense.name}
                            onChange={(e) => updateExpense(expense.id, 'name', e.target.value)}
                            placeholder="e.g., House rent"
                            className="h-9 md:h-10 text-sm pointer-events-auto"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`expense-amount-${expense.id}`} className="text-xs md:text-sm">Amount (₹)</Label>
                          <Input
                            id={`expense-amount-${expense.id}`}
                            type="number"
                            value={expense.amount}
                            onChange={(e) => updateExpense(expense.id, 'amount', e.target.value)}
                            placeholder="15000"
                            className="h-9 md:h-10 text-sm pointer-events-auto"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`expense-frequency-${expense.id}`} className="text-xs md:text-sm">Frequency</Label>
                          <Select 
                            value={expense.frequency} 
                            onValueChange={(value: 'monthly' | 'annually') => updateExpense(expense.id, 'frequency', value)}
                          >
                            <SelectTrigger className="h-9 md:h-10 pointer-events-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="annually">Annually</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      <div className="flex justify-end">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeExpense(expense.id)}
                          className="pointer-events-auto"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                
                <Button variant="outline" onClick={addExpense} className="w-full h-10 md:h-11 pointer-events-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Expense
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Step 3: Investments */}
          <TabsContent value="3" className="space-y-4 md:space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <PieChart className="h-5 w-5" />
                  Investment Portfolio
                </CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Track your investments to optimize tax benefits and wealth building
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {investments.length === 0 ? (
                  <div className="text-center py-6 md:py-8 text-muted-foreground">
                    <PieChart className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">No investments added. Add your investments to get better tax planning suggestions.</p>
                  </div>
                ) : (
                  investments.map((investment) => (
                    <div key={investment.id} className="grid grid-cols-1 gap-4 p-4 rounded-lg border bg-card">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <Label htmlFor={`investment-type-${investment.id}`} className="text-xs md:text-sm">Investment Type</Label>
                          <Select 
                            value={investment.type} 
                            onValueChange={(value) => updateInvestment(investment.id, 'type', value)}
                          >
                            <SelectTrigger className="h-9 md:h-10 pointer-events-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {investmentTypes.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                  {type.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div>
                          <Label htmlFor={`investment-name-${investment.id}`} className="text-xs md:text-sm">Investment Name</Label>
                          <Input
                            id={`investment-name-${investment.id}`}
                            value={investment.name}
                            onChange={(e) => updateInvestment(investment.id, 'name', e.target.value)}
                            placeholder="e.g., HDFC Equity Fund"
                            className="h-9 md:h-10 text-sm pointer-events-auto"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`investment-amount-${investment.id}`} className="text-xs md:text-sm">Monthly Amount (₹)</Label>
                          <Input
                            id={`investment-amount-${investment.id}`}
                            type="number"
                            value={investment.amount}
                            onChange={(e) => updateInvestment(investment.id, 'amount', e.target.value)}
                            placeholder="5000"
                            className="h-9 md:h-10 text-sm pointer-events-auto"
                          />
                        </div>
                      </div>
                      
                      <div className="flex justify-end">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeInvestment(investment.id)}
                          className="pointer-events-auto"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
                
                <Button variant="outline" onClick={addInvestment} className="w-full h-10 md:h-11 pointer-events-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Investment
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Navigation */}
        <div className="flex flex-col md:flex-row justify-between gap-4 mt-6 md:mt-8">
          {/* Desktop Navigation */}
          <div className="hidden md:flex justify-between w-full">
            <Button 
              variant="outline" 
              onClick={prevStep}
              disabled={currentStep === 1}
              className="h-10 md:h-11 pointer-events-auto"
            >
              Previous
            </Button>
            
            <div className="flex gap-2">
              <Button variant="outline" className="h-10 md:h-11 pointer-events-auto">
                Skip for now
              </Button>
              {currentStep < 3 ? (
                <Button onClick={nextStep} className="h-10 md:h-11 pointer-events-auto">
                  Next Step
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Link to="/dashboard">
                  <Button className="bg-gradient-primary text-primary-foreground h-10 md:h-11 pointer-events-auto">
                    Complete Setup
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Mobile Navigation - Single Row */}
          <div className="md:hidden flex justify-between gap-2">
            <Button 
              variant="outline" 
              onClick={prevStep}
              disabled={currentStep === 1}
              className="h-10 flex-1 pointer-events-auto"
              size="sm"
            >
              Previous
            </Button>
            
            <Button variant="outline" className="h-10 flex-1 pointer-events-auto" size="sm">
              Skip for now
            </Button>
            
            {currentStep < 3 ? (
              <Button onClick={nextStep} className="h-10 flex-1 bg-primary text-primary-foreground pointer-events-auto" size="sm">
                Next Step
              </Button>
            ) : (
              <Link to="/dashboard" className="flex-1">
                <Button className="h-10 w-full bg-primary text-primary-foreground pointer-events-auto" size="sm">
                  Complete
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Gamification Banner - Bottom */}
        <Card className="mt-8 bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-2">
              <Target className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <CardTitle className="text-base md:text-lg text-green-800">Boost Your Financial Intelligence!</CardTitle>
                <CardDescription className="text-xs md:text-sm text-green-700">
                  The more accurate your information, the better we can help you save on taxes and grow your wealth. 
                  Complete all sections to unlock maximum savings potential! 🎯
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
};

export default IncomeGathering;
