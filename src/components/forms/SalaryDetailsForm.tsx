import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { GlassCard } from "@/components/ui/glass-card";
import { Info } from "lucide-react";

const salarySchema = z.object({
  // Basic Personal Information
  fullName: z.string().min(1, "Full name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  pan: z.string().min(10, "Valid PAN is required").max(10),
  residentialStatus: z.string().min(1, "Residential status is required"),
  
  // Employment Details
  employerName: z.string().optional(),
  employerTAN: z.string().optional(),
  financialYear: z.string().optional(),
  
  // Salary Structure
  basicSalary: z.string().optional(),
  dearnessAllowance: z.string().optional(),
  houseRentAllowance: z.string().optional(),
  otherAllowances: z.string().optional(),
  bonus: z.string().optional(),
  perquisites: z.string().optional(),
  professionalTax: z.string().optional(),
  epfContribution: z.string().optional(),
  
  // Tax-Specific Information
  rentPaid: z.string().optional(),
  cityOfResidence: z.string().optional(),
  standardDeduction: z.string().optional(),
  tdsDetails: z.string().optional(),
  changedJobs: z.boolean().optional(),
  
  // Other Income
  interestIncome: z.string().optional(),
  dividendIncome: z.string().optional(),
  otherReimbursements: z.string().optional(),
  
  // Freelance Details
  professionNature: z.string().optional(),
  industryCategory: z.string().optional(),
  grossReceipts: z.string().optional(),
  foreignCurrency: z.boolean().optional(),
  gstNumber: z.string().optional(),
  businessExpenses: z.string().optional(),
  presumptiveTaxation: z.boolean().optional(),
  advanceTax: z.string().optional(),
  tdsReceived: z.string().optional(),
});

interface SalaryDetailsFormProps {
  onSubmit: (data: any) => void;
  onBack: () => void;
  preFilledData?: {
    fullName?: string;
    pan?: string;
    email?: string;
    phone?: string;
  };
  savedData?: any;
}

export const SalaryDetailsForm = ({ onSubmit, onBack, preFilledData, savedData }: SalaryDetailsFormProps) => {
  const [userType, setUserType] = useState<"salaried" | "freelancer" | "both">("salaried");

  const form = useForm<z.infer<typeof salarySchema>>({
    resolver: zodResolver(salarySchema),
    defaultValues: {
      standardDeduction: "75000", // Auto-filled for FY 2025-26
      fullName: "",
      pan: "",
    },
  });

  // Update form values when preFilledData or savedData changes
  useEffect(() => {
    // First set saved data if available (previously filled form)
    if (savedData) {
      Object.keys(savedData).forEach(key => {
        if (savedData[key] !== undefined && savedData[key] !== null) {
          form.setValue(key as any, savedData[key]);
        }
      });
    }
    
    // Then set prefilled data only if there's no saved data for those fields
    if (preFilledData) {
      if (preFilledData.fullName && (!savedData || !savedData.fullName)) {
        form.setValue("fullName", preFilledData.fullName);
      }
      if (preFilledData.pan && (!savedData || !savedData.pan)) {
        form.setValue("pan", preFilledData.pan);
      }
    }
  }, [preFilledData, savedData, form]);

  const TooltipField = ({ children, tooltip }: { children: React.ReactNode; tooltip: string }) => (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {children}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground cursor-help pointer-events-auto" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Label>What best describes your income source?</Label>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={userType === "salaried" ? "default" : "outline"}
            onClick={() => setUserType("salaried")}
            size="sm"
            className="pointer-events-auto"
          >
            Salaried
          </Button>
          <Button
            variant={userType === "freelancer" ? "default" : "outline"}
            onClick={() => setUserType("freelancer")}
            size="sm"
            className="pointer-events-auto"
          >
            Freelancer
          </Button>
          <Button
            variant={userType === "both" ? "default" : "outline"}
            onClick={() => setUserType("both")}
            size="sm"
            className="pointer-events-auto"
          >
            Both
          </Button>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Accordion type="multiple" defaultValue={["personal"]} className="w-full">
            {/* Basic Personal Information */}
            <AccordionItem value="personal">
              <AccordionTrigger className="pointer-events-auto">Basic Personal Information</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Enter your full name as per PAN card">
                          <FormLabel>Full Name *</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="Enter full name" {...field} className="pointer-events-auto" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Required to determine age-based tax slab">
                          <FormLabel>Date of Birth *</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input type="date" {...field} className="pointer-events-auto" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pan"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="10-character alphanumeric PAN number">
                          <FormLabel>PAN Number *</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="ABCDE1234F" maxLength={10} {...field} className="pointer-events-auto" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="residentialStatus"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Determines tax rates and exemptions">
                          <FormLabel>Residential Status *</FormLabel>
                        </TooltipField>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="pointer-events-auto">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="indian-resident">Indian Resident</SelectItem>
                            <SelectItem value="nri">Non-Resident Indian (NRI)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Employment & Salary Section */}
            {(userType === "salaried" || userType === "both") && (
              <AccordionItem value="employment">
                <AccordionTrigger className="pointer-events-auto">Employment & Salary Breakdown</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="employerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Employer Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Company name" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="employerTAN"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="10-character Tax Deduction Account Number">
                            <FormLabel>Employer's TAN</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="ABCD12345E" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="basicSalary"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="Basic salary component (monthly or yearly)">
                            <FormLabel>Basic Salary (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="houseRentAllowance"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="HRA received from employer">
                            <FormLabel>House Rent Allowance (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="dearnessAllowance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dearness Allowance (₹)</FormLabel>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="otherAllowances"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="Conveyance, LTA, medical, etc.">
                            <FormLabel>Other Allowances (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="bonus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus/Performance Pay (₹)</FormLabel>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="perquisites"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="Company car, accommodation, stock options">
                            <FormLabel>Perquisites/Benefits (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="Amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Freelance Section */}
            {(userType === "freelancer" || userType === "both") && (
              <AccordionItem value="freelance">
                <AccordionTrigger className="pointer-events-auto">Freelance/Professional Details</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="professionNature"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nature of Profession</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., IT Consultant, Designer" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="grossReceipts"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="Total annual receipts/turnover">
                            <FormLabel>Gross Receipts (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Input placeholder="Annual amount" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="gstNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>GST Registration Number</FormLabel>
                          <FormControl>
                            <Input placeholder="If registered" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="businessExpenses"
                      render={({ field }) => (
                        <FormItem>
                          <TooltipField tooltip="Rent, internet, staff, software, travel, assets">
                            <FormLabel>Business Expenses (₹)</FormLabel>
                          </TooltipField>
                          <FormControl>
                            <Textarea placeholder="List major expenses with amounts" {...field} className="pointer-events-auto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="presumptiveTaxation"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="pointer-events-auto"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <TooltipField tooltip="Section 44ADA - Presumptive taxation scheme">
                              <FormLabel>Opt for Presumptive Taxation</FormLabel>
                            </TooltipField>
                          </div>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="foreignCurrency"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="pointer-events-auto"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <TooltipField tooltip="For export income and FCRA compliance">
                              <FormLabel>Received payments in foreign currency</FormLabel>
                            </TooltipField>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Tax Information */}
            <AccordionItem value="tax-info">
              <AccordionTrigger className="pointer-events-auto">Tax-Specific Information</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="rentPaid"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Annual rent paid (for HRA exemption)">
                          <FormLabel>Rent Paid (₹)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="Annual amount" {...field} className="pointer-events-auto" />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="cityOfResidence"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Required for HRA exemption calculation">
                          <FormLabel>City of Residence</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="City name" {...field} className="pointer-events-auto" />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="standardDeduction"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Auto-applied ₹75,000 for FY 2025-26">
                          <FormLabel>Standard Deduction (₹)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input {...field} disabled className="pointer-events-auto" />
                        </FormControl>
                        <FormDescription>
                          ₹75,000 auto-applied for FY 2025-26
                        </FormDescription>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tdsDetails"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="TDS deducted by employer/clients">
                          <FormLabel>TDS Details (₹)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="Total TDS amount" {...field} className="pointer-events-auto" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="changedJobs"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="pointer-events-auto"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Did you change jobs during the year?</FormLabel>
                        <FormDescription>
                          Check if you need to provide previous employer details
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Other Income */}
            <AccordionItem value="other-income">
              <AccordionTrigger className="pointer-events-auto">Other Income Sources</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="interestIncome"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Interest from savings, FDs, etc.">
                          <FormLabel>Interest Income (₹)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="Annual amount" {...field} className="pointer-events-auto" />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dividendIncome"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Dividend from shares, mutual funds">
                          <FormLabel>Dividend Income (₹)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input placeholder="Annual amount" {...field} className="pointer-events-auto" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex gap-4 pt-6">
            <Button type="submit" className="flex-1 pointer-events-auto">
              Save & Continue
            </Button>
            <Button type="button" variant="outline" onClick={onBack} className="pointer-events-auto">
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};