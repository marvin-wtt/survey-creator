import {
  ArrayChanges,
  Base,
  JsonObjectProperty,
  Serializer
} from "survey-core";
import { EditableObject } from "../../editable-object";

export interface IUndoRedoChange {
  object: any;
  propertyName: string;
  oldValue: any;
  newValue: any;
}

export class UndoRedoManager {
  constructor() { }
  public onPropertyValueChanged(
    name: string,
    oldValue: any,
    newValue: any,
    sender: Base,
    arrayChanges: ArrayChanges
  ) {
    if (EditableObject.isCopyObject(sender)) return;
    if (this._ignoreChanges) return;

    let transaction = this._preparingTransaction;
    let action = arrayChanges
      ? new UndoRedoArrayAction(name, sender, arrayChanges)
      : new UndoRedoAction(name, oldValue, newValue, sender);

    if (!transaction) {
      transaction = new Transaction(name);
      transaction.addAction(action);
      this._addTransaction(transaction);
      return;
    }

    transaction.addAction(action);
  }
  public isCorrectProperty(sender: Base, propertyName: string): boolean {
    var prop: JsonObjectProperty = Serializer.findProperty(
      sender.getType(),
      propertyName
    );
    return !!prop && prop.isSerializable;
  }
  public tryMergeTransaction(sender: Base, propertyName: string, newValue: any): boolean {
    if(propertyName === "name") return false; //TODO check on
    const lastTransaction = this._getCurrentTransaction();
    if(!lastTransaction || lastTransaction.actions.length == 0) return false;
    const lastAction = lastTransaction.actions[lastTransaction.actions.length - 1];
    return lastAction.tryMerge(sender, propertyName, newValue);
  }
  private _ignoreChanges = false;
  private _preparingTransaction: Transaction = null;
  private _transactions: Transaction[] = [];
  private _currentTransactionIndex: number = -1;

  public isCopyObject(sender: Base) { }
  private _cutOffTail() {
    if (this._currentTransactionIndex + 1 !== this._transactions.length) {
      this._transactions.length = this._currentTransactionIndex + 1;
    }
  }
  private _addTransaction(transaction: Transaction) {
    if (transaction.isEmpty()) return;

    this._cutOffTail();
    this._transactions.push(transaction);
    this._currentTransactionIndex++;
    this.canUndoRedoCallback();
  }
  private _getCurrentTransaction() {
    const index = this._currentTransactionIndex;
    const currentTransaction = this._transactions[index];
    return currentTransaction;
  }
  private _getNextTransaction() {
    const index = this._currentTransactionIndex;
    const nextTransaction = this._transactions[index + 1];
    return nextTransaction;
  }
  private notifyChangesFinished(transaction: Transaction) {
    if (transaction.actions.length > 0 && transaction.actions[0]) {
      !!this.changesFinishedCallback &&
        this.changesFinishedCallback(transaction.actions[0].getChanges());
    }
  }
  canUndoRedoCallback() { }
  private transactionCounter = 0;
  startTransaction(name: string) {
    this.transactionCounter++;
    if (this._preparingTransaction) return;
    this._preparingTransaction = new Transaction(name);
  }
  stopTransaction() {
    if (this.transactionCounter > 0) {
      this.transactionCounter--;
    }
    if (!this._preparingTransaction || this.transactionCounter > 0) return;
    this._addTransaction(this._preparingTransaction);
    if (this.transactionCounter === 0) {
      this.notifyChangesFinished(this._preparingTransaction);
    }
    this._preparingTransaction = null;
  }
  canUndo() {
    return !!this._getCurrentTransaction();
  }
  undo() {
    const currentTransaction = this._getCurrentTransaction();
    if (!this.canUndo()) return;

    this._ignoreChanges = true;
    currentTransaction.rollback();
    this._ignoreChanges = false;

    this._currentTransactionIndex--;
    this.canUndoRedoCallback();
    this.notifyChangesFinished(currentTransaction);
  }
  canRedo() {
    return !!this._getNextTransaction();
  }
  redo() {
    const nextTransaction = this._getNextTransaction();
    if (!this.canRedo()) return;

    this._ignoreChanges = true;
    nextTransaction.apply();
    this._ignoreChanges = false;

    this._currentTransactionIndex++;
    this.canUndoRedoCallback();
    this.notifyChangesFinished(nextTransaction);
  }
  suspend() {
    this._ignoreChanges = true;
  }
  resume() {
    this._ignoreChanges = false;
  }
  public changesFinishedCallback: (changes: IUndoRedoChange) => void;
}

export class Transaction {
  constructor(private _name: string) { }

  private _actions: UndoRedoAction[] = [];

  apply() {
    const actions = this._actions;
    for (let index = 0; index < actions.length; index++) {
      const action = actions[index];
      action.apply();
    }
  }

  rollback() {
    const actions = this._actions;
    for (let index = actions.length - 1; index >= 0; index--) {
      const action = actions[index];
      action.rollback();
    }
  }

  addAction(action: any) {
    this._actions.push(action);
  }

  isEmpty(): boolean {
    return this._actions.length === 0;
  }

  get actions() {
    return this._actions;
  }
}

export interface IUndoRedoAction {
  apply: () => void;
  rollback: () => void;
  getChanges(): IUndoRedoChange;
  tryMerge(sender: Base, propertyName: string, newValue: any): boolean;
}

export class UndoRedoAction implements IUndoRedoAction {
  constructor(
    private _propertyName: string,
    private _oldValue: any,
    private _newValue: any,
    private _sender: Base
  ) { }

  apply(): void {
    this._sender[this._propertyName] = this._newValue;
  }

  rollback(): void {
    this._sender[this._propertyName] = this._oldValue;
  }

  getChanges(): IUndoRedoChange {
    return {
      object: this._sender,
      propertyName: this._propertyName,
      oldValue: this._oldValue,
      newValue: this._newValue
    };
  }
  tryMerge(sender: Base, propertyName: string, newValue: any): boolean {
    if(sender !== this._sender || propertyName !== this._propertyName || newValue == this._oldValue) return false;
    const prop = Serializer.findProperty(sender.getType(), propertyName);
    if(!prop || (prop.type !== "string" && prop.type !== "text")) return false;
    this._newValue = newValue;
    return true;
  }
}

export class UndoRedoArrayAction implements IUndoRedoAction {
  private _index: number = 0;
  private _itemsToAdd: any[] = [];
  private _deletedItems: any[] = [];

  constructor(
    private _propertyName: string,
    private _sender: Base,
    arrayChanges: ArrayChanges
  ) {
    this._index = arrayChanges.index;
    this._itemsToAdd = arrayChanges.itemsToAdd;
    this._deletedItems = arrayChanges.deletedItems;
  }
  apply(): void {
    this.rollback();
  }
  rollback(): void {
    const array = this._sender[this._propertyName];
    const index = this._index;
    const deleteCount = this._itemsToAdd.length;
    const itemsToAdd = [].concat(this._deletedItems);

    this._deletedItems = array.splice.apply(
      array,
      [index, deleteCount].concat(itemsToAdd)
    );
    this._itemsToAdd = [].concat(itemsToAdd);
  }
  getChanges(): IUndoRedoChange {
    return {
      object: this._sender,
      propertyName: this._propertyName,
      oldValue: this._deletedItems,
      newValue: this._itemsToAdd
    };
  }
  tryMerge(sender: Base, propertyName: string, newValue: any): boolean {
    return false;
  }
}