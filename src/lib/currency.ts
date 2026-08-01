/**
 * Currency formatting utilities for Indian Rupees
 */

/**
 * Formats a number as Indian Rupees with proper formatting
 * @param amount - The amount to format
 * @param options - Formatting options
 * @returns Formatted currency string
 */
export function formatINR(
  amount: number | string,
  options: {
    showDecimals?: boolean;
    showSymbol?: boolean;
    useIndianNumbering?: boolean;
  } = {}
): string {
  const {
    showDecimals = true,
    showSymbol = true,
    useIndianNumbering = true,
  } = options;

  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) return showSymbol ? "₹0" : "0";

  // Format with Indian numbering system (lakhs and crores)
  if (useIndianNumbering) {
    const absAmount = Math.abs(numAmount);
    const isNegative = numAmount < 0;
    
    let formatted: string;
    
    if (absAmount >= 10000000) { // 1 crore
      const crores = absAmount / 10000000;
      formatted = `${crores.toFixed(showDecimals ? 2 : 0)} Cr`;
    } else if (absAmount >= 100000) { // 1 lakh
      const lakhs = absAmount / 100000;
      formatted = `${lakhs.toFixed(showDecimals ? 2 : 0)} L`;
    } else if (absAmount >= 1000) { // 1 thousand
      const thousands = absAmount / 1000;
      formatted = `${thousands.toFixed(showDecimals ? 1 : 0)}K`;
    } else {
      formatted = showDecimals 
        ? absAmount.toFixed(2)
        : Math.round(absAmount).toString();
    }
    
    const sign = isNegative ? "-" : "";
    const symbol = showSymbol ? "₹" : "";
    
    return `${sign}${symbol}${formatted}`;
  }

  // Standard formatting without Indian numbering
  const formatter = new Intl.NumberFormat("en-IN", {
    style: showSymbol ? "currency" : "decimal",
    currency: "INR",
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });

  return formatter.format(numAmount);
}

/**
 * Formats amount as compact Indian currency (e.g., ₹1.2L, ₹5.5Cr)
 */
export function formatCompactINR(amount: number | string): string {
  return formatINR(amount, {
    showDecimals: true,
    showSymbol: true,
    useIndianNumbering: true,
  });
}

/**
 * Formats amount as full Indian currency with standard notation
 */
export function formatFullINR(amount: number | string): string {
  return formatINR(amount, {
    showDecimals: true,
    showSymbol: true,
    useIndianNumbering: false,
  });
}

/**
 * Formats amount without currency symbol
 */
export function formatNumberINR(amount: number | string): string {
  return formatINR(amount, {
    showDecimals: true,
    showSymbol: false,
    useIndianNumbering: true,
  });
}