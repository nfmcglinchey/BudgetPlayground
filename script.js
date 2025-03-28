// Firebase Configuration and Initialization
const firebaseConfig = {
  apiKey: "AIzaSyDZY3fLWVQUho5_kr1cySBS3hAENfCjK-A",
  authDomain: "budget-ca6cc.firebaseapp.com",
  databaseURL: "https://budget-ca6cc-default-rtdb.firebaseio.com",
  projectId: "budget-ca6cc",
  storageBucket: "budget-ca6cc.firebasestorage.app",
  messagingSenderId: "511560833155",
  appId: "1:511560833155:web:06974e4d2afc68decda3b6"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Global Variables
// FRONT SIDE (Discretionary Budget)
let expensesListener = null;
let spendingChart;
let pieChart;
let chartUpdateTimeout = null;
let showAllExpenses = false;
let editingExpenseId = null;
let budgetCategories = [];

// BACK SIDE (Static Budget)
let staticSpendingChart;
let staticPieChart;
let staticChartUpdateTimeout = null;
let staticCategories = [];

// NEW GLOBALS FOR WEEKLY SUMMARY
let weeklyIncome = 0;
let weeklyExpenses = 0;

// Utility Functions
function isMobile() {
  return ('ontouchstart' in window) || (window.innerWidth <= 768);
}

function setDefaultDate(selector) {
  const dateInput = document.getElementById(selector);
  if (!dateInput) {
    console.error("Date input field not found: " + selector);
    return;
  }
  const today = new Date();
  dateInput.value = today.toISOString().slice(0, 10);
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function showNotification(message) {
  const notif = document.getElementById("notification");
  if (notif) {
    notif.textContent = message;
    notif.classList.add("show");
    setTimeout(() => notif.classList.remove("show"), 3000);
  }
}

function showNotificationStatic(message) {
  const notif = document.getElementById("notification-back");
  if (notif) {
    notif.textContent = message;
    notif.classList.add("show");
    setTimeout(() => notif.classList.remove("show"), 3000);
  }
}

function customConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById("modal");
    const modalMessage = document.getElementById("modal-message");
    const confirmBtn = document.getElementById("modal-confirm");
    const cancelBtn = document.getElementById("modal-cancel");
    modalMessage.textContent = message;
    modal.style.display = "flex";
    document.body.classList.add("modal-open");

    function cleanup() {
      modal.style.display = "none";
      document.body.classList.remove("modal-open");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
    }
    function onConfirm() {
      cleanup();
      resolve(true);
    }
    function onCancel() {
      cleanup();
      resolve(false);
    }
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// Weekly Summary Update Function
function updateWeeklySummary() {
  // Calculate static weekly expenses based on staticCategories
  let staticWeekly = 0;
  if (staticCategories && staticCategories.length > 0) {
    staticCategories.forEach(cat => {
      staticWeekly += parseFloat(cat.monthly) * 12 / 52;
    });
  }
  // Combine dynamic and static weekly expenses
  const combinedWeeklyExpenses = weeklyExpenses + staticWeekly;
  
  document.getElementById("weekly-income").textContent = "Income: $" + weeklyIncome.toFixed(2);
  document.getElementById("weekly-expenses").textContent = "Expenses: $" + combinedWeeklyExpenses.toFixed(2);
  const net = weeklyIncome - combinedWeeklyExpenses;
  document.getElementById("net-weekly").textContent = "Net: $" + net.toFixed(2);
}

// FRONT SIDE Functions (Discretionary Budget)
async function loadCategories() {
  try {
    db.ref("categories").on("value", snapshot => {
      if (snapshot.numChildren() === 0) {
        const defaults = [
          { name: "Groceries", monthly: 1200 },
          { name: "Dining Out", monthly: 400 },
          { name: "Entertainment", monthly: 200 },
          { name: "Haircuts", monthly: 52 },
          { name: "Alcohol", monthly: 150 },
          { name: "Weekly Allowance", monthly: 1040 },
          { name: "Miscellaneous", monthly: 0 }
        ];
        defaults.forEach(defaultCat => {
          db.ref("categories").push(defaultCat);
        });
        return;
      }
      budgetCategories = [];
      snapshot.forEach(childSnapshot => {
        let cat = childSnapshot.val();
        cat.id = childSnapshot.key;
        budgetCategories.push(cat);
      });
      renderCategoryList();
      populateExpenseCategoryDropdown();
      loadBudget();
      loadExpenses();
    });
  } catch (error) {
    console.error("Error loading categories:", error);
    showNotification("Error loading categories.");
  }
}

function renderCategoryList() {
  const container = document.getElementById("category-list");
  container.innerHTML = "";
  const table = document.createElement("table");
  table.id = "category-table";
  table.innerHTML = `
    <tr>
      <th>Category</th>
      <th>Monthly Budget</th>
      <th>Actions</th>
    </tr>
  `;
  budgetCategories.forEach((cat) => {
    const monthlyVal = parseFloat(cat.monthly).toFixed(2);
    let row = document.createElement("tr");
    if (isMobile()) {
      row.classList.add("expense-swipe");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.style.position = "relative";

      const swipeActions = document.createElement("div");
      swipeActions.classList.add("swipe-actions");
      const editBtn = document.createElement("button");
      editBtn.classList.add("swipe-edit");
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        const newName = prompt("Edit category name:", cat.name);
        const newMonthly = parseFloat(prompt("Edit monthly budget:", cat.monthly));
        if (newName && !isNaN(newMonthly)) {
          if (
            newName.toLowerCase() !== cat.name.toLowerCase() &&
            budgetCategories.some(c => c.name.toLowerCase() === newName.toLowerCase())
          ) {
            showNotification("Duplicate category name. Please enter a unique category.");
            return;
          }
          if (newName.toLowerCase() !== cat.name.toLowerCase()) {
            customConfirm("Would you like to update all previous expenses under this category?")
              .then(confirmed => {
                if (confirmed) {
                  db.ref("expenses").orderByChild("category").equalTo(cat.name)
                    .once("value")
                    .then(snapshot => {
                      snapshot.forEach(childSnapshot => {
                        childSnapshot.ref.update({ category: newName });
                      });
                    })
                    .then(() => db.ref("categories/" + cat.id).update({ name: newName, monthly: newMonthly }))
                    .then(() => showNotification("Category and related expenses updated successfully."))
                    .catch(error => {
                      console.error("Error updating category or expenses:", error);
                      showNotification("Error updating category or expenses.");
                    });
                } else {
                  db.ref("categories/" + cat.id).update({ name: newName, monthly: newMonthly })
                    .then(() => showNotification("Category updated successfully."))
                    .catch(error => {
                      console.error("Error updating category:", error);
                      showNotification("Error updating category.");
                    });
                }
              });
          } else {
            db.ref("categories/" + cat.id).update({ monthly: newMonthly })
              .then(() => showNotification("Category updated successfully."))
              .catch(error => {
                console.error("Error updating category:", error);
                showNotification("Error updating category.");
              });
          }
        } else {
          showNotification("Invalid input for editing category.");
        }
      });
      swipeActions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.classList.add("swipe-delete");
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        customConfirm("Delete this category?")
          .then(confirmed => {
            if (confirmed) {
              db.ref("categories/" + cat.id).remove()
                .catch(error => {
                  console.error("Error deleting category:", error);
                  showNotification("Error deleting category.");
                });
            }
          });
      });
      swipeActions.appendChild(deleteBtn);

      const swipeContent = document.createElement("div");
      swipeContent.classList.add("swipe-content");
      swipeContent.innerHTML = `
        <div class="expense-details">
          <span class="date">${cat.name}</span>
          <span class="amount">$${monthlyVal}</span>
        </div>
      `;
      cell.appendChild(swipeActions);
      cell.appendChild(swipeContent);
      row.appendChild(cell);
    } else {
      const nameCell = document.createElement("td");
      nameCell.textContent = cat.name;
      row.appendChild(nameCell);

      const budgetCell = document.createElement("td");
      budgetCell.textContent = `$${monthlyVal}`;
      row.appendChild(budgetCell);

      const actionCell = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.style.marginRight = "8px";
      editBtn.addEventListener("click", () => {
        const newName = prompt("Edit category name:", cat.name);
        const newMonthly = parseFloat(prompt("Edit monthly budget:", cat.monthly));
        if (newName && !isNaN(newMonthly)) {
          if (
            newName.toLowerCase() !== cat.name.toLowerCase() &&
            budgetCategories.some(c => c.name.toLowerCase() === newName.toLowerCase())
          ) {
            showNotification("Duplicate category name. Please enter a unique category.");
            return;
          }
          if (newName.toLowerCase() !== cat.name.toLowerCase()) {
            customConfirm("Would you like to update all previous expenses under this category?")
              .then(confirmed => {
                if (confirmed) {
                  db.ref("expenses").orderByChild("category").equalTo(cat.name)
                    .once("value")
                    .then(snapshot => {
                      snapshot.forEach(childSnapshot => {
                        childSnapshot.ref.update({ category: newName });
                      });
                    })
                    .then(() => db.ref("categories/" + cat.id).update({ name: newName, monthly: newMonthly }))
                    .then(() => showNotification("Category and related expenses updated successfully."))
                    .catch(error => {
                      console.error("Error updating category or expenses:", error);
                      showNotification("Error updating category or expenses.");
                    });
                } else {
                  db.ref("categories/" + cat.id).update({ name: newName, monthly: newMonthly })
                    .then(() => showNotification("Category updated successfully."))
                    .catch(error => {
                      console.error("Error updating category:", error);
                      showNotification("Error updating category.");
                    });
                }
              });
          } else {
            db.ref("categories/" + cat.id).update({ monthly: newMonthly })
              .then(() => showNotification("Category updated successfully."))
              .catch(error => {
                console.error("Error updating category:", error);
                showNotification("Error updating category.");
              });
          }
        } else {
          showNotification("Invalid input for editing category.");
        }
      });
      actionCell.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        customConfirm("Delete this category?")
          .then(confirmed => {
            if (confirmed) {
              db.ref("categories/" + cat.id).remove()
                .catch(error => {
                  console.error("Error deleting category:", error);
                  showNotification("Error deleting category.");
                });
            }
          });
      });
      actionCell.appendChild(deleteBtn);
      row.appendChild(actionCell);
    }
    table.appendChild(row);
  });
  container.appendChild(table);
}

function populateExpenseCategoryDropdown() {
  const categoryDropdown = document.getElementById("expense-category");
  categoryDropdown.innerHTML = "";
  budgetCategories.forEach(cat => {
    const option = document.createElement("option");
    option.value = cat.name;
    option.textContent = cat.name;
    categoryDropdown.appendChild(option);
  });
}

function addCategory() {
  const newName = document.getElementById("new-category-name").value.trim();
  const newMonthly = parseFloat(document.getElementById("new-category-monthly").value);
  if (!newName || isNaN(newMonthly)) {
    showNotification("Please enter a valid category name and monthly budget.");
    return;
  }
  if (budgetCategories.some(cat => cat.name.toLowerCase() === newName.toLowerCase())) {
    showNotification("Duplicate category name.");
    return;
  }
  db.ref("categories").push({ name: newName, monthly: newMonthly })
    .then(() => {
      document.getElementById("new-category-name").value = "";
      document.getElementById("new-category-monthly").value = "";
      showNotification("Category added successfully.");
    })
    .catch(err => {
      console.error("Error adding category:", err);
      showNotification("Error adding category.");
    });
}

function loadBudget() {
  const budgetTable = document.getElementById("budget-table");
  if (!budgetTable) {
    console.error("Budget table not found");
    return;
  }
  budgetTable.innerHTML = `
    <tr>
      <th>Category</th>
      <th>Monthly Budget</th>
      <th>Weekly Budget</th>
      <th>Actual (Month)</th>
      <th>Actual (Week)</th>
    </tr>
  `;
  let totalMonthly = 0;
  let totalWeekly = 0;
  budgetCategories.forEach(category => {
    const monthlyVal = parseFloat(category.monthly);
    const weeklyBudget = (monthlyVal * 12 / 52).toFixed(2);
    totalMonthly += monthlyVal;
    totalWeekly += parseFloat(weeklyBudget);
    const row = budgetTable.insertRow();
    row.innerHTML = `
      <td>${category.name}</td>
      <td>$${monthlyVal.toFixed(2)}</td>
      <td>$${weeklyBudget}</td>
      <td class="actual-month" data-total="0">$0.00</td>
      <td class="actual-week" data-total="0">$0.00</td>
    `;
  });
  const totalRow = budgetTable.insertRow();
  totalRow.innerHTML = `
    <td><strong>Total</strong></td>
    <td><strong>$${totalMonthly.toFixed(2)}</strong></td>
    <td><strong>$${totalWeekly.toFixed(2)}</strong></td>
    <td class="actual-month"><strong>$0.00</strong></td>
    <td class="actual-week"><strong>$0.00</strong></td>
  `;
  totalRow.classList.add("total-row");
}

async function addExpense() {
  try {
    const date = document.getElementById("expense-date")?.value;
    const category = document.getElementById("expense-category")?.value;
    const description = document.getElementById("expense-description")?.value.trim();
    const rawAmount = document.getElementById("expense-amount")?.value;
    const numericString = rawAmount.replace(/[^0-9.]/g, '');
    const amount = parseFloat(numericString);

    if (!date || !category || !description || isNaN(amount) || amount <= 0) {
      showNotification("Please enter valid details.");
      return;
    }
    const expenseData = { date, category, description, amount };

    if (editingExpenseId) {
      await db.ref("expenses/" + editingExpenseId).update(expenseData);
      showNotification("Expense updated successfully");
    } else {
      await db.ref("expenses").push(expenseData);
      showNotification("Expense added successfully");
    }
    resetExpenseForm();
  } catch (error) {
    console.error("Error processing expense:", error);
    showNotification("Error processing expense. Please try again.");
  }
}

function resetExpenseForm() {
  document.getElementById("expense-date").value = new Date().toISOString().slice(0,10);
  document.getElementById("expense-category").selectedIndex = 0;
  document.getElementById("expense-description").value = "";
  document.getElementById("expense-amount").value = "";
  editingExpenseId = null;
  document.getElementById("add-expense-button").textContent = "Add Expense";
  document.getElementById("cancel-edit-button").style.display = "none";
  document.getElementById("add-expense-section").classList.remove("editing-mode");
}

function editExpense(expenseId, date, category, description, amount) {
  editingExpenseId = expenseId;
  document.getElementById("expense-date").value = date;
  document.getElementById("expense-category").value = category;
  document.getElementById("expense-description").value = description;
  document.getElementById("expense-amount").value = `$${amount.toFixed(2)}`;
  document.getElementById("add-expense-button").textContent = "Update Expense";
  document.getElementById("cancel-edit-button").style.display = "inline-block";

  const addExpenseSection = document.getElementById("add-expense-section");
  const collapsibleContent = addExpenseSection.querySelector('.collapsible-content');
  if (collapsibleContent && (collapsibleContent.style.display === "none" || collapsibleContent.style.display === "")) {
    collapsibleContent.style.display = "block";
    const header = addExpenseSection.querySelector('.collapsible-header');
    if (header) header.classList.add("expanded");
  }
  addExpenseSection.classList.add("editing-mode");
  addExpenseSection.scrollIntoView({ behavior: "smooth" });
}

function cancelEdit() {
  resetExpenseForm();
}

function loadExpenses() {
  const expensesTable = document.getElementById("expenses-table");
  if (!expensesTable) {
    console.error("Expenses table not found");
    return;
  }
  const toggleButton = document.getElementById("toggle-expenses-button");
  if (toggleButton) {
    toggleButton.textContent = showAllExpenses ? "Show Newest 5" : "Show All";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getDay() - 5 + 7) % 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - diff);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  if (expensesListener) {
    db.ref("expenses").off("value", expensesListener);
  }
  expensesListener = (snapshot) => {
    expensesTable.innerHTML = `
      <tr>
        <th>Date</th>
        <th>Category</th>
        <th>Description</th>
        <th>Amount</th>
        <th>Action</th>
      </tr>
    `;
    resetBudgetActuals();
    const selectedMonth = document.getElementById("filter-month")?.value;
    const selectedYear = document.getElementById("filter-year")?.value;
    const monthlyExpenses = [];

    snapshot.forEach(childSnapshot => {
      const expense = childSnapshot.val();
      const expenseDate = parseLocalDate(expense.date);
      const expenseMonth = (expenseDate.getMonth() + 1).toString();
      const expenseYear = expenseDate.getFullYear().toString();

      if (expenseMonth === selectedMonth && expenseYear === selectedYear) {
        updateBudgetTotals(expense.category, expense.amount, expenseDate, "month");
        monthlyExpenses.push({
          key: childSnapshot.key,
          date: expense.date,
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          parsedDate: expenseDate
        });
      }
      if (expenseDate >= startOfWeek && expenseDate < endOfWeek) {
        updateBudgetTotals(expense.category, expense.amount, expenseDate, "week");
      }
    });

    monthlyExpenses.sort((a, b) => b.parsedDate - a.parsedDate);
    const finalExpenses = showAllExpenses ? monthlyExpenses : monthlyExpenses.slice(0, 5);

    finalExpenses.forEach(exp => {
      const formattedDate = formatDate(exp.date);
      if (isMobile()) {
        const row = document.createElement("tr");
        row.classList.add("expense-swipe");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.style.position = "relative";

        const swipeActions = document.createElement("div");
        swipeActions.classList.add("swipe-actions");
        const editBtn = document.createElement("button");
        editBtn.classList.add("swipe-edit");
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
          editExpense(exp.key, exp.date, exp.category, exp.description, exp.amount);
        });
        swipeActions.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.classList.add("swipe-delete");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          customConfirm("Swipe delete: Are you sure you want to delete this expense?")
            .then(confirmed => {
              if (confirmed) {
                deleteExpense(exp.key);
              }
            });
        });
        swipeActions.appendChild(deleteBtn);

        const swipeContent = document.createElement("div");
        swipeContent.classList.add("swipe-content");
        swipeContent.innerHTML = `
          <div class="expense-details">
            <span class="date">${formattedDate}</span>
            <span class="category">${exp.category}</span>
            <span class="description">${exp.description || "—"}</span>
            <span class="amount">$${exp.amount.toFixed(2)}</span>
          </div>
        `;
        cell.appendChild(swipeActions);
        cell.appendChild(swipeContent);
        row.appendChild(cell);
        expensesTable.appendChild(row);

        let startX = 0, currentX = 0;
        const threshold = 80;
        const fullSwipeThreshold = -250;

        swipeContent.addEventListener("touchstart", function(e) {
          startX = e.touches[0].clientX;
          swipeContent.style.transition = "";
        });
        swipeContent.addEventListener("touchmove", function(e) {
          currentX = e.touches[0].clientX;
          let deltaX = currentX - startX;
          if (deltaX < 0) {
            swipeContent.style.transform = `translateX(${deltaX}px)`;
          }
        });
        swipeContent.addEventListener("touchend", function() {
          let deltaX = currentX - startX;
          if (deltaX < fullSwipeThreshold) {
            swipeContent.style.transition = "transform 0.3s ease";
            swipeContent.style.transform = "translateX(-100%)";
            customConfirm("Swipe delete: Are you sure you want to delete this expense?")
              .then(confirmed => {
                if (confirmed) {
                  deleteExpense(exp.key);
                } else {
                  swipeContent.style.transition = "transform 0.3s ease";
                  swipeContent.style.transform = "translateX(0)";
                }
              });
          } else if (deltaX < -threshold) {
            swipeContent.style.transition = "transform 0.3s ease";
            swipeContent.style.transform = "translateX(-160px)";
          } else {
            swipeContent.style.transition = "transform 0.3s ease";
            swipeContent.style.transform = "translateX(0)";
          }
        });
      } else {
        const row = document.createElement("tr");
        row.classList.add("expense-swipe");
        const dateCell = document.createElement("td");
        dateCell.textContent = formattedDate;
        row.appendChild(dateCell);

        const categoryCell = document.createElement("td");
        categoryCell.textContent = exp.category;
        row.appendChild(categoryCell);

        const descCell = document.createElement("td");
        descCell.textContent = exp.description || "—";
        row.appendChild(descCell);

        const amountCell = document.createElement("td");
        amountCell.textContent = `$${exp.amount.toFixed(2)}`;
        row.appendChild(amountCell);

        const actionCell = document.createElement("td");
        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.style.marginRight = "8px";
        editBtn.addEventListener("click", () => {
          editExpense(exp.key, exp.date, exp.category, exp.description, exp.amount);
        });
        actionCell.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          customConfirm("Are you sure you want to delete this expense?")
            .then(confirmed => {
              if (confirmed) {
                deleteExpense(exp.key);
              }
            });
        });
        actionCell.appendChild(deleteBtn);
        row.appendChild(actionCell);

        expensesTable.appendChild(row);
      }
    });

    updateTotalRow();
    updateChartDebounced();
    updatePieChart();
  };
  db.ref("expenses").on("value", expensesListener);
}

function deleteExpense(expenseId) {
  if (!expenseId) {
    console.error("Invalid expense ID");
    return;
  }
  db.ref("expenses/" + expenseId).remove()
    .then(() => {
      console.log("Expense deleted successfully");
      showNotification("Expense deleted successfully");
    })
    .catch(error => {
      console.error("Error deleting expense:", error);
      showNotification("Error deleting expense");
    });
}

function resetBudgetActuals() {
  const budgetTable = document.getElementById("budget-table");
  const rows = budgetTable.getElementsByTagName("tr");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cells[3]) {
      rows[i].cells[3].setAttribute("data-total", "0");
      rows[i].cells[3].textContent = "$0.00";
    }
    if (rows[i].cells[4]) {
      rows[i].cells[4].setAttribute("data-total", "0");
      rows[i].cells[4].textContent = "$0.00";
    }
  }
}

function updateBudgetTotals(category, amount, expenseDate, type) {
  const budgetTable = document.getElementById("budget-table");
  const rows = budgetTable.getElementsByTagName("tr");
  for (let i = 1; i < rows.length - 1; i++) {
    const row = rows[i];
    const rowCategory = row.cells[0].textContent;
    if (rowCategory === category) {
      if (type === "month") {
        const actualMonthCell = row.cells[3];
        let currentMonthTotal = parseFloat(actualMonthCell.getAttribute('data-total')) || 0;
        const newMonthTotal = currentMonthTotal + amount;
        actualMonthCell.setAttribute('data-total', newMonthTotal);

        const monthlyBudget = parseFloat(row.cells[1].textContent.replace("$", ""));
        applyBudgetColors(actualMonthCell, newMonthTotal, monthlyBudget);

        if (newMonthTotal > monthlyBudget) {
          actualMonthCell.innerHTML = `$${newMonthTotal.toFixed(2)} <span class="warning-icon" title="Over Budget!">⚠</span>`;
        } else {
          actualMonthCell.textContent = `$${newMonthTotal.toFixed(2)}`;
        }
      } else if (type === "week") {
        const actualWeekCell = row.cells[4];
        let currentWeekTotal = parseFloat(actualWeekCell.getAttribute('data-total')) || 0;
        const newWeekTotal = currentWeekTotal + amount;
        actualWeekCell.setAttribute('data-total', newWeekTotal);

        const weeklyBudget = parseFloat(row.cells[2].textContent.replace("$", ""));
        applyBudgetColors(actualWeekCell, newWeekTotal, weeklyBudget);

        if (newWeekTotal > weeklyBudget) {
          actualWeekCell.innerHTML = `$${newWeekTotal.toFixed(2)} <span class="warning-icon" title="Over Budget!">⚠</span>`;
        } else {
          actualWeekCell.textContent = `$${newWeekTotal.toFixed(2)}`;
        }
      }
    }
  }
}

function updateTotalRow() {
  const budgetTable = document.getElementById("budget-table");
  const rows = budgetTable.getElementsByTagName("tr");
  let totalMonthActual = 0;
  let totalWeekActual = 0;
  for (let i = 1; i < rows.length - 1; i++) {
    totalMonthActual += parseFloat(rows[i].cells[3].getAttribute("data-total")) || 0;
    totalWeekActual += parseFloat(rows[i].cells[4].getAttribute("data-total")) || 0;
  }
  const totalRow = rows[rows.length - 1];
  totalRow.cells[3].innerHTML = `<strong>$${totalMonthActual.toFixed(2)}</strong>`;
  totalRow.cells[4].innerHTML = `<strong>$${totalWeekActual.toFixed(2)}</strong>`;
  highlightCell(totalRow.cells[4]);

  weeklyExpenses = totalWeekActual;
  updateWeeklySummary();
}

function highlightCell(cell) {
  cell.setAttribute("tabindex", "-1");
  cell.classList.add("highlight-week");
  cell.focus({ preventScroll: true });
  setTimeout(() => {
    cell.classList.remove("highlight-week");
  }, 1500);
}

function applyBudgetColors(cell, actual, budget) {
  cell.classList.remove("over-budget", "near-budget", "under-budget");
  if (actual > budget) {
    cell.classList.add("over-budget");
    cell.title = "Over budget: Spending exceeds the set budget.";
  } else if (actual > budget * 0.75) {
    cell.classList.add("near-budget");
    cell.title = "Near budget: Spending is close to the budget limit.";
  } else {
    cell.classList.add("under-budget");
    cell.title = "Under budget: Spending is within budget limits.";
  }
}

function populateFilters() {
  const monthSelect = document.getElementById("filter-month");
  const yearSelect = document.getElementById("filter-year");
  if (!monthSelect || !yearSelect) {
    console.error("Dropdowns not found.");
    return;
  }
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  monthSelect.innerHTML = months
    .map((month, index) => {
      const isSelected = (index + 1 === currentMonth) ? "selected" : "";
      return `<option value="${index + 1}" ${isSelected}>${month}</option>`;
    })
    .join("");
  yearSelect.innerHTML = [...Array(11)]
    .map((_, i) => {
      const year = currentYear - i;
      const isSelected = (year === currentYear) ? "selected" : "";
      return `<option value="${year}" ${isSelected}>${year}</option>`;
    })
    .join("");
  loadExpenses();
}

function initializeChart() {
  const ctx = document.getElementById("chart-canvas").getContext("2d");
  const isDark = document.body.classList.contains('dark-mode');
  spendingChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Monthly Budget",
          data: [],
          backgroundColor: isDark ? "#1d72b8" : "#1D72B8",
        },
        {
          label: "Actual Spending",
          data: [],
          backgroundColor: isDark ? "#ff3b30" : "#FF3B30",
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: isDark ? "#555" : "#ddd" } },
        y: { grid: { color: isDark ? "#555" : "#ddd" } }
      }
    }
  });
}

function initializePieChart() {
  const ctx = document.getElementById("pie-chart-canvas").getContext("2d");
  pieChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#34c759"
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
    }
  });
}

function updateChartDebounced() {
  if (chartUpdateTimeout) clearTimeout(chartUpdateTimeout);
  chartUpdateTimeout = setTimeout(() => {
    updateChart();
    chartUpdateTimeout = null;
  }, 300);
}

function updateChart() {
  const budgetTable = document.getElementById("budget-table");
  if (!budgetTable) return;
  const rows = budgetTable.getElementsByTagName("tr");
  const labels = [];
  const budgetValues = [];
  const actualValues = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const cells = rows[i].cells;
    labels.push(cells[0].textContent);
    const budgetValue = parseFloat(cells[1].textContent.replace("$", "")) || 0;
    const actualValue = parseFloat(cells[3].getAttribute("data-total")) || 0;
    budgetValues.push(budgetValue);
    actualValues.push(actualValue);
  }
  if (spendingChart) {
    spendingChart.data.labels = labels;
    spendingChart.data.datasets[0].data = budgetValues;
    spendingChart.data.datasets[1].data = actualValues;
    spendingChart.update();
  }
}

function updatePieChart() {
  const budgetTable = document.getElementById("budget-table");
  if (!budgetTable) return;
  const rows = budgetTable.getElementsByTagName("tr");
  const categorySpending = {};
  budgetCategories.forEach(cat => {
    categorySpending[cat.name] = 0;
  });
  for (let i = 1; i < rows.length - 1; i++) {
    const cells = rows[i].cells;
    const category = cells[0].textContent;
    const actualSpending = parseFloat(cells[3].getAttribute("data-total")) || 0;
    if (categorySpending.hasOwnProperty(category)) {
      categorySpending[category] += actualSpending;
    }
  }
  const labels = Object.keys(categorySpending);
  const data = Object.values(categorySpending);
  if (pieChart) {
    pieChart.data.labels = labels;
    pieChart.data.datasets[0].data = data;
    pieChart.update();
  }
}

// BACK SIDE Functions (Static Budget)
async function loadCategoriesStatic() {
  try {
    db.ref("staticCategories").on("value", snapshot => {
      if (snapshot.numChildren() === 0) {
        const defaults = [
          { name: "Groceries", monthly: 1200 },
          { name: "Dining Out", monthly: 400 },
          { name: "Entertainment", monthly: 200 },
          { name: "Haircuts", monthly: 52 },
          { name: "Alcohol", monthly: 150 },
          { name: "Weekly Allowance", monthly: 1040 },
          { name: "Miscellaneous", monthly: 0 }
        ];
        defaults.forEach(defaultCat => {
          db.ref("staticCategories").push(defaultCat);
        });
        return;
      }
      staticCategories = [];
      snapshot.forEach(childSnapshot => {
        let cat = childSnapshot.val();
        cat.id = childSnapshot.key;
        staticCategories.push(cat);
      });
      renderCategoryListStatic();
      loadBudgetStatic();
    });
  } catch (error) {
    console.error("Error loading static categories:", error);
    showNotificationStatic("Error loading categories.");
  }
}

function renderCategoryListStatic() {
  const container = document.getElementById("category-list-back");
  container.innerHTML = "";
  const table = document.createElement("table");
  table.id = "category-table-back";
  table.innerHTML = `
    <tr>
      <th>Category</th>
      <th>Monthly Budget</th>
      <th>Actions</th>
    </tr>
  `;
  staticCategories.forEach((cat) => {
    const monthlyVal = parseFloat(cat.monthly).toFixed(2);
    let row = document.createElement("tr");
    if (isMobile()) {
      row.classList.add("expense-swipe");
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.style.position = "relative";

      const swipeActions = document.createElement("div");
      swipeActions.classList.add("swipe-actions");
      const editBtn = document.createElement("button");
      editBtn.classList.add("swipe-edit");
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        const newName = prompt("Edit category name:", cat.name);
        const newMonthly = parseFloat(prompt("Edit monthly budget:", cat.monthly));
        if (newName && !isNaN(newMonthly)) {
          if (
            newName.toLowerCase() !== cat.name.toLowerCase() &&
            staticCategories.some(c => c.name.toLowerCase() === newName.toLowerCase())
          ) {
            showNotificationStatic("Duplicate category name. Please enter a unique category.");
            return;
          }
          if (newName.toLowerCase() !== cat.name.toLowerCase()) {
            customConfirm("Would you like to update all previous expenses under this category?")
              .then(confirmed => {
                if (confirmed) {
                  db.ref("staticExpenses").orderByChild("category").equalTo(cat.name)
                    .once("value")
                    .then(snapshot => {
                      snapshot.forEach(childSnapshot => {
                        childSnapshot.ref.update({ category: newName });
                      });
                    })
                    .then(() => db.ref("staticCategories/" + cat.id).update({ name: newName, monthly: newMonthly }))
                    .then(() => showNotificationStatic("Category and related expenses updated successfully."))
                    .catch(error => {
                      console.error("Error updating static category or expenses:", error);
                      showNotificationStatic("Error updating category or expenses.");
                    });
                } else {
                  db.ref("staticCategories/" + cat.id).update({ name: newName, monthly: newMonthly })
                    .then(() => showNotificationStatic("Category updated successfully."))
                    .catch(error => {
                      console.error("Error updating static category:", error);
                      showNotificationStatic("Error updating category.");
                    });
                }
              });
          } else {
            db.ref("staticCategories/" + cat.id).update({ monthly: newMonthly })
              .then(() => showNotificationStatic("Category updated successfully."))
              .catch(error => {
                console.error("Error updating static category:", error);
                showNotificationStatic("Error updating category.");
              });
          }
        } else {
          showNotificationStatic("Invalid input for editing category.");
        }
      });
      swipeActions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.classList.add("swipe-delete");
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        customConfirm("Delete this category?")
          .then(confirmed => {
            if (confirmed) {
              db.ref("staticCategories/" + cat.id).remove()
                .catch(error => {
                  console.error("Error deleting static category:", error);
                  showNotificationStatic("Error deleting category.");
                });
            }
          });
      });
      swipeActions.appendChild(deleteBtn);

      const swipeContent = document.createElement("div");
      swipeContent.classList.add("swipe-content");
      swipeContent.innerHTML = `
        <div class="expense-details">
          <span class="date">${cat.name}</span>
          <span class="amount">$${monthlyVal}</span>
        </div>
      `;
      cell.appendChild(swipeActions);
      cell.appendChild(swipeContent);
      row.appendChild(cell);
    } else {
      const nameCell = document.createElement("td");
      nameCell.textContent = cat.name;
      row.appendChild(nameCell);

      const budgetCell = document.createElement("td");
      budgetCell.textContent = `$${monthlyVal}`;
      row.appendChild(budgetCell);

      const actionCell = document.createElement("td");
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.style.marginRight = "8px";
      editBtn.addEventListener("click", () => {
        const newName = prompt("Edit category name:", cat.name);
        const newMonthly = parseFloat(prompt("Edit monthly budget:", cat.monthly));
        if (newName && !isNaN(newMonthly)) {
          if (
            newName.toLowerCase() !== cat.name.toLowerCase() &&
            staticCategories.some(c => c.name.toLowerCase() === newName.toLowerCase())
          ) {
            showNotificationStatic("Duplicate category name. Please enter a unique category.");
            return;
          }
          if (newName.toLowerCase() !== cat.name.toLowerCase()) {
            customConfirm("Would you like to update all previous expenses under this category?")
              .then(confirmed => {
                if (confirmed) {
                  db.ref("staticExpenses").orderByChild("category").equalTo(cat.name)
                    .once("value")
                    .then(snapshot => {
                      snapshot.forEach(childSnapshot => {
                        childSnapshot.ref.update({ category: newName });
                      });
                    })
                    .then(() => db.ref("staticCategories/" + cat.id).update({ name: newName, monthly: newMonthly }))
                    .then(() => showNotificationStatic("Category and related expenses updated successfully."))
                    .catch(error => {
                      console.error("Error updating static category or expenses:", error);
                      showNotificationStatic("Error updating category or expenses.");
                    });
                } else {
                  db.ref("staticCategories/" + cat.id).update({ name: newName, monthly: newMonthly })
                    .then(() => showNotificationStatic("Category updated successfully."))
                    .catch(error => {
                      console.error("Error updating static category:", error);
                      showNotificationStatic("Error updating category.");
                    });
                }
              });
          } else {
            db.ref("staticCategories/" + cat.id).update({ monthly: newMonthly })
              .then(() => showNotificationStatic("Category updated successfully."))
              .catch(error => {
                console.error("Error updating static category:", error);
                showNotificationStatic("Error updating category.");
              });
          }
        } else {
          showNotificationStatic("Invalid input for editing category.");
        }
      });
      actionCell.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        customConfirm("Delete this category?")
          .then(confirmed => {
            if (confirmed) {
              db.ref("staticCategories/" + cat.id).remove()
                .catch(error => {
                  console.error("Error deleting static category:", error);
                  showNotificationStatic("Error deleting category.");
                });
            }
          });
      });
      actionCell.appendChild(deleteBtn);
      row.appendChild(actionCell);
    }
    table.appendChild(row);
  });
  container.appendChild(table);
}

function loadBudgetStatic() {
  const budgetTable = document.getElementById("budget-table-back");
  if (!budgetTable) {
    console.error("Static budget table not found");
    return;
  }
  budgetTable.innerHTML = `
    <tr>
      <th>Category</th>
      <th>Annual Budget</th>
      <th>Monthly Budget</th>
      <th>Weekly Budget</th>
    </tr>
  `;
  let totalMonthly = 0;
  staticCategories.forEach(category => {
    const monthlyVal = parseFloat(category.monthly);
    const annualBudget = monthlyVal * 12;
    const weeklyBudget = monthlyVal * 12 / 52;
    totalMonthly += monthlyVal;

    const row = budgetTable.insertRow();
    row.innerHTML = `
      <td>${category.name}</td>
      <td>$${annualBudget.toFixed(2)}</td>
      <td>$${monthlyVal.toFixed(2)}</td>
      <td>$${weeklyBudget.toFixed(2)}</td>
    `;
  });
  const totalAnnual = totalMonthly * 12;
  const totalWeekly = totalMonthly * 12 / 52;
  const totalRow = budgetTable.insertRow();
  totalRow.innerHTML = `
    <td><strong>Total</strong></td>
    <td><strong>$${totalAnnual.toFixed(2)}</strong></td>
    <td><strong>$${totalMonthly.toFixed(2)}</strong></td>
    <td><strong>$${totalWeekly.toFixed(2)}</strong></td>
  `;
  totalRow.classList.add("total-row");

  updateChartStatic();
  updatePieChartStatic();
}

function addCategoryStatic() {
  const newNameEl = document.getElementById("new-category-name-back");
  const newMonthlyEl = document.getElementById("new-category-monthly-back");
  if (!newNameEl || !newMonthlyEl) return;

  const newName = newNameEl.value.trim();
  const newMonthly = parseFloat(newMonthlyEl.value);
  if (!newName || isNaN(newMonthly)) {
    showNotificationStatic("Please enter a valid category name and monthly budget.");
    return;
  }
  db.ref("staticCategories").push({ name: newName, monthly: newMonthly })
    .then(() => {
      newNameEl.value = "";
      newMonthlyEl.value = "";
      showNotificationStatic("Category added successfully.");
    })
    .catch(err => {
      console.error("Error adding static category:", err);
      showNotificationStatic("Error adding category.");
    });
}

/* Coin Flip & Card Collapse */
let isCoinHeads = true;
const coinFlipDiv = document.getElementById('coin-flip');
const coinImage = document.getElementById('coin-image');

coinFlipDiv.addEventListener('click', () => {
  coinFlipDiv.classList.toggle('flip');
  if (isCoinHeads) {
    coinImage.src = 'coin-tails.png';
  } else {
    coinImage.src = 'coin-heads.png';
  }
  isCoinHeads = !isCoinHeads;

  const flipCard = document.getElementById("budget-flip-card");
  flipCard.classList.toggle("flip");

  if (flipCard.classList.contains("flip")) {
    document.querySelectorAll('.flip-card-front .collapsible-content').forEach(content => {
      content.style.display = "none";
    });
    document.querySelectorAll('.flip-card-front .collapsible-header').forEach(header => {
      header.classList.remove("expanded");
    });
  } else {
    document.querySelectorAll('.flip-card-back .collapsible-content').forEach(content => {
      content.style.display = "none";
    });
    document.querySelectorAll('.flip-card-back .collapsible-header').forEach(header => {
      header.classList.remove("expanded");
    });
  }
});

/* Chart Functions for Back Side */
function updateChartStatic() {
  const budgetTable = document.getElementById("budget-table-back");
  if (!budgetTable) return;
  const rows = budgetTable.getElementsByTagName("tr");
  const labels = [];
  const weeklyBudgets = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const cells = rows[i].cells;
    labels.push(cells[0].textContent);
    const weeklyBudget = parseFloat(cells[3].textContent.replace("$", "")) || 0;
    weeklyBudgets.push(weeklyBudget);
  }
  if (staticSpendingChart) {
    staticSpendingChart.data.labels = labels;
    staticSpendingChart.data.datasets[0].data = weeklyBudgets;
    staticSpendingChart.data.datasets[1].data = weeklyBudgets.map(() => 0);
    staticSpendingChart.update();
  }
}

function updatePieChartStatic() {
  const budgetTable = document.getElementById("budget-table-back");
  if (!budgetTable) return;
  const rows = budgetTable.getElementsByTagName("tr");
  const categoryBudgets = {};
  staticCategories.forEach(cat => {
    categoryBudgets[cat.name] = 0;
  });
  for (let i = 1; i < rows.length - 1; i++) {
    const cells = rows[i].cells;
    const category = cells[0].textContent;
    const weeklyBudget = parseFloat(cells[3].textContent.replace("$", "")) || 0;
    if (categoryBudgets.hasOwnProperty(category)) {
      categoryBudgets[category] += weeklyBudget;
    }
  }
  const labels = Object.keys(categoryBudgets);
  const data = Object.values(categoryBudgets);
  if (staticPieChart) {
    staticPieChart.data.labels = labels;
    staticPieChart.data.datasets[0].data = data;
    staticPieChart.update();
  }
}

function initializeChartStatic() {
  const ctx = document.getElementById("chart-canvas-back").getContext("2d");
  const isDark = document.body.classList.contains('dark-mode');
  staticSpendingChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Weekly Budget",
          data: [],
          backgroundColor: isDark ? "#1d72b8" : "#1D72B8",
        },
        {
          label: "Placeholder",
          data: [],
          backgroundColor: isDark ? "#ff3b30" : "#FF3B30",
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: isDark ? "#555" : "#ddd" } },
        y: { grid: { color: isDark ? "#555" : "#ddd" } }
      }
    }
  });
}

function initializePieChartStatic() {
  const ctx = document.getElementById("pie-chart-canvas-back").getContext("2d");
  staticPieChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#34c759"
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
    }
  });
}

/* Collapsible Headers for Both Sides */
document.querySelectorAll('.collapsible-header').forEach(header => {
  header.addEventListener('click', () => {
    const content = header.nextElementSibling;
    if (content.style.display === "none" || content.style.display === "") {
      content.style.display = "block";
      header.classList.add("expanded");

      if (header.parentElement && header.parentElement.id === "pie-chart-section-back") {
        setTimeout(() => {
          if (staticPieChart) {
            staticPieChart.resize();
            staticPieChart.update();
          }
        }, 300);
      }
    } else {
      content.style.display = "none";
      header.classList.remove("expanded");
    }
  });
});

/* DOMContentLoaded & Event Listeners */
document.addEventListener("DOMContentLoaded", function () {
  // Theme toggle
  const themeCheckbox = document.getElementById('theme-toggle-checkbox');
  if (!localStorage.getItem('theme')) {
    document.body.classList.add('dark-mode');
    localStorage.setItem('theme', 'dark');
    themeCheckbox.checked = true;
  } else if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
    themeCheckbox.checked = true;
  }
  themeCheckbox.addEventListener('change', function() {
    if (themeCheckbox.checked) {
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  });

  // FRONT SIDE initialization
  setTimeout(() => setDefaultDate("expense-date"), 500);
  loadCategories();
  populateFilters();
  initializeChart();
  initializePieChart();
  document.getElementById("add-expense-button").addEventListener("click", addExpense);
  const cancelEditButton = document.getElementById("cancel-edit-button");
  if (cancelEditButton) {
    cancelEditButton.addEventListener("click", cancelEdit);
  }
  document.getElementById("filter-month").addEventListener("change", loadExpenses);
  document.getElementById("filter-year").addEventListener("change", loadExpenses);
  const toggleButton = document.getElementById("toggle-expenses-button");
  if (toggleButton) {
    toggleButton.addEventListener("click", () => {
      showAllExpenses = !showAllExpenses;
      loadExpenses();
    });
  }
  document.getElementById("add-category-button").addEventListener("click", addCategory);

  // Manage Categories toggle (Front)
  document.getElementById('toggle-manage-categories').addEventListener('click', () => {
    const manageCategoriesCard = document.getElementById('manage-categories');
    manageCategoriesCard.style.display = (
      manageCategoriesCard.style.display === 'none' ||
      manageCategoriesCard.style.display === ''
    )
      ? 'block'
      : 'none';
  });

  // BACK SIDE initialization
  loadCategoriesStatic();
  document.getElementById('toggle-manage-categories-back').addEventListener('click', () => {
    const manageCategoriesCard = document.getElementById('manage-categories-back');
    manageCategoriesCard.style.display = (
      manageCategoriesCard.style.display === 'none' ||
      manageCategoriesCard.style.display === ''
    )
      ? 'block'
      : 'none';
  });
  document.getElementById("add-category-button-back").addEventListener("click", addCategoryStatic);
  initializeChartStatic();
  initializePieChartStatic();
  loadBudgetStatic();
  
  // New Take-Home Income Initialization
  const incomeVariability = document.getElementById("income-variability");
  if (incomeVariability) {
    incomeVariability.addEventListener("change", function() {
      const mode = this.value;
      if (mode === "constant") {
        document.getElementById("constant-income-section").style.display = "block";
      } else {
        document.getElementById("constant-income-section").style.display = "none";
        if (isPayday()) {
          promptForVariableIncome();
        }
      }
    });
  }
  
  const editConstantIncomeBtn = document.getElementById("edit-constant-income");
  if (editConstantIncomeBtn) {
    editConstantIncomeBtn.addEventListener("click", function() {
      const newIncome = prompt("Enter your new constant take-home amount:");
      if (newIncome && !isNaN(parseFloat(newIncome))) {
        const value = parseFloat(newIncome);
        document.getElementById("constant-income").value = value.toFixed(2);
        weeklyIncome = value;
        console.log("Constant Income updated to: $" + value.toFixed(2));
        updateWeeklySummary();
      }
    });
  }

  // Direct update of income when the input value changes
  document.getElementById("constant-income").addEventListener("change", function() {
    const value = parseFloat(this.value);
    if (!isNaN(value)) {
      weeklyIncome = value;
      updateWeeklySummary();
    }
  });

  // NEW: Toggle slide-out panel for Income Settings
  document.getElementById('income-slide-toggle').addEventListener('click', function() {
    document.getElementById('income-slide-out').classList.toggle('open');
  });
});

// Function to determine if it's payday (example: every Friday)
function isPayday() {
  const today = new Date();
  return today.getDay() === 5;
}

function promptForVariableIncome() {
  const income = prompt("Enter today's take-home amount:");
  if (income && !isNaN(parseFloat(income))) {
    const value = parseFloat(income);
    weeklyIncome = value;
    console.log("Variable Income for Payday: $" + value.toFixed(2));
    updateWeeklySummary();
    // Optionally, save this income value to your database or local storage.
  }
}
