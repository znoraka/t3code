import { useCallback } from "react";
import { useT3ChatStore } from "../../t3chatStore";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function T3ChatModelSelector() {
  const selectedModel = useT3ChatStore((s) => s.selectedModel);
  const availableModels = useT3ChatStore((s) => s.availableModels);
  const setModel = useT3ChatStore((s) => s.setModel);

  const handleChange = useCallback(
    (value: string | null) => {
      if (value) setModel(value);
    },
    [setModel],
  );

  const items = availableModels.map((m) => ({ value: m.id, label: m.label }));

  return (
    <Select value={selectedModel} onValueChange={handleChange} items={items}>
      <SelectTrigger variant="ghost" size="xs" className="font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup className="max-h-80 overflow-y-auto">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
