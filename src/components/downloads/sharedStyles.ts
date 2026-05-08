import { StyleSheet } from "react-native";

export const sharedStyles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#222",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 8,
  },
  modalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#EEE",
  },
  modalPrimaryBtn: {
    backgroundColor: "#2196F3",
  },
  modalBtnText: {
    color: "#333",
    fontSize: 14,
    fontWeight: "600",
  },
  modalPrimaryBtnText: {
    color: "#FFF",
  },
  moveOptions: {
    gap: 8,
  },
  moveOptionBtn: {
    borderRadius: 8,
    backgroundColor: "#F2F2F2",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  moveTreeOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  moveOptionText: {
    fontSize: 14,
    color: "#222",
    fontWeight: "600",
  },
  labelPickerEmpty: {
    fontSize: 13,
    color: "#999",
    marginBottom: 10,
    fontStyle: "italic",
  },
  labelPickerAddRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    alignItems: "center",
  },
  labelPickerInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    color: "#222",
  },
  labelPickerAddBtn: {
    backgroundColor: "#1A73E8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  labelPickerAddBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
