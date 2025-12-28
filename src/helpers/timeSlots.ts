// توليد الأوقات من 09:00 ص إلى 10:00 م
export function generateSalonTimeSlots() {
  const slots = [];
  for (let h = 9; h <= 22; h++) {
    let hour = h === 12 ? 12 : h % 12 || 12;
    let suffix = h < 12 ? "ص" : "م";
    let display = `${hour < 10 ? "0" : ""}${hour}:00 ${suffix}`;
    slots.push(display.trim());
  }
  return slots;
}
