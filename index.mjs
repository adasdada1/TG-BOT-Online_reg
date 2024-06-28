import {
  Bot,
  GrammyError,
  HttpError,
  session,
  Keyboard,
  InlineKeyboard,
} from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import mysql from "mysql2";
import { config } from "dotenv";
import fs from "fs";
import fsPromise from "fs/promises";
import { getTimeTaken, postNewReg } from "./databases-functions.mjs";
config();
const bot = new Bot(process.env.BOT_API_KEY);
const ADMIN = process.env.ADMINS;

const connection = mysql
  .createConnection({
    host: "localhost",
    user: "root",
    database: "onlineRegistration_db",
    password: "",
  })
  .promise(); //настоящие данные - в dotenv. На локалхосте не хочу пихать туда

const reg = new RegExp("(\\d{2}).(\\d{2}).(\\d{4})");
bot.use(
  session({
    initial: () => ({}),
  })
);
bot.use(conversations());
const inlineKeyboard = new InlineKeyboard().text("Отмена", "cancel");
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Добро пожаловать в наш бот для записи! Введите команду /faq для получения справки о боте."
  );
});

bot.callbackQuery("cancel", async (ctx) => {
  await ctx.reply("Вы нажали отмена.", {
    reply_markup: { remove_keyboard: true },
  });
  await ctx.conversation.exit();
  return await ctx.answerCallbackQuery({
    text: "Отмена",
  });
});

function getServices() {
  return JSON.parse(fs.readFileSync("./services.json").toString());
}

function checkService(services, serviceText) {
  for (let i = 0; i < services.length; i++) {
    if (services[i].service === serviceText.msg.text) {
      return services[i];
    }
  }
  return false;
}

function getTime(
  timeOfStart,
  gap,
  timeOfEnd,
  initialTime = null,
  timeOfRegistration = []
) {
  if (initialTime === null) {
    initialTime = timeOfStart;
    timeOfRegistration.push(initialTime);
  }

  const timeSplitted = timeOfStart.split(":");
  const timeOfEndSplitted = timeOfEnd.split(":");

  let hours = parseInt(timeSplitted[0]);
  let minutes = parseInt(timeSplitted[1]);
  minutes += parseInt(gap);

  hours += Math.floor(minutes / 60);
  minutes = minutes % 60;
  hours = hours % 24;

  const newTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}`;

  if (newTime === timeOfEnd || timeOfRegistration.includes(newTime)) {
    return timeOfRegistration;
  }

  const startMinutes =
    parseInt(initialTime.split(":")[0]) * 60 +
    parseInt(initialTime.split(":")[1]);
  const endMinutes =
    parseInt(timeOfEnd.split(":")[0]) * 60 + parseInt(timeOfEnd.split(":")[1]);
  const currentMinutes = hours * 60 + minutes;

  if (startMinutes < endMinutes) {
    if (currentMinutes > endMinutes) {
      return timeOfRegistration;
    }
  } else {
    if (currentMinutes > endMinutes && currentMinutes < startMinutes) {
      return timeOfRegistration;
    }
  }

  timeOfRegistration.push(newTime);
  return getTime(newTime, gap, timeOfEnd, initialTime, timeOfRegistration);
}

function unique(first, second) {
  if (first.length > second.length) [first, second] = [second, first];
  return second.filter((item) => !first.includes(item));
}

function isAdmin(id) {
  if (JSON.parse(ADMIN).includes(id)) {
    return true;
  }
}

async function isText(conversation, ctx) {
  let messageText = await conversation.wait();
  while (!messageText.msg?.text) {
    await ctx.reply("Это не текст. Попробуйте еще раз.", {
      reply_markup: inlineKeyboard,
    });
    messageText = await conversation.wait();
  }
  return messageText;
}

function isValidDate(day, month, year) {
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }
  if ((month == 4 || month == 6 || month == 9 || month == 11) && day == 31) {
    return false;
  }
  if (month == 2) {
    var leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    if (day > 29 || (day == 29 && !leap)) {
      return false;
    }
  }
  return true;
}

async function registration(conversation, ctx) {
  try {
    const services = getServices();
    const servicesKeyB = getServices().map((label) => [
      Keyboard.text(label.service),
    ]);

    const postKeyBoard = Keyboard.from(servicesKeyB).resized().row().oneTime();
    await ctx.reply("Выберите услугу", {
      reply_markup: postKeyBoard,
    });

    let serviceText = await conversation.wait();
    let service = checkService(services, serviceText);
    while (!service) {
      await ctx.reply(`Пожалуйста, выберите услугу из предложенных.`, {
        reply_markup: inlineKeyboard,
      });
      serviceText = await conversation.wait();
      service = checkService(services, serviceText);
    }

    await ctx.reply(
      "Напишите дату в формате: день.месяц.год. Например 01.01.2024",
      {
        reply_markup: { remove_keyboard: true },
      }
    );

    const regNum = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
    let nonDate = await isText(conversation, ctx);
    let nonDateSplitted = nonDate.msg.text.split(".");

    while (
      !reg.test(nonDate.msg.text) ||
      !isValidDate(
        nonDateSplitted[0],
        nonDateSplitted[1],
        nonDateSplitted[2]
      ) ||
      nonDateSplitted[2] < new Date().getFullYear() ||
      nonDateSplitted[1] < new Date().getMonth() + 1 ||
      (nonDateSplitted[0] < new Date().getDate() &&
        nonDateSplitted[1] <= new Date().getMonth() + 1)
    ) {
      await ctx.reply(
        `Неверно введена дата.
Напишите в формате: день.месяц.год. Например 01.01.2024.`,
        {
          reply_markup: inlineKeyboard,
        }
      );
      nonDate = await conversation.wait();
      nonDateSplitted = nonDate.msg.text.split(".");
    }

    const date = nonDate.msg.text.split(".").reverse();

    const timeOfRegistration = [];
    getTime(
      service.timeOfStart,
      service.time,
      service.timeOfEnd,
      null,
      timeOfRegistration
    );
    const timeTaken = await getTimeTaken(date, serviceText.msg.text);
    const uniqueTime = unique(timeTaken, timeOfRegistration);

    await ctx.reply(
      `
<b>Свободное время для записи на сегодня:</b>
${uniqueTime.join("\n")}

Напишите желаемое время записи из списка доступных в формате: чч:мм. Например 12:00`,
      { parse_mode: "HTML" }
    );

    let time = await isText(conversation, ctx);

    while (!uniqueTime.includes(time.msg.text)) {
      await ctx.reply(
        `Неверно введено время или же оно уже занято.
Напишите желаемое время записи из списка доступных в формате: чч:мм. Например 12:00

<b>Свободное время для записи на сегодня:</b>
${uniqueTime.join("\n")}`,
        {
          reply_markup: inlineKeyboard,
          parse_mode: "HTML",
        }
      );

      time = await conversation.wait();
    }

    const result = await connection.query(
      "SELECT * FROM Info WHERE date = ? AND time = ? AND service = ?",
      [date.join("-"), time.msg.text + ":00", serviceText.msg.text]
    );
    if (result[0].length) {
      await ctx.reply("Данное время уже занято.");
      return;
    }

    await ctx.reply("Введите ваш номер телефона");
    let number = await isText(conversation, ctx);

    while (!regNum.test(number.msg.text)) {
      await ctx.reply(
        `Неверно введен номер телефона.
Попробуйте еще раз`,
        {
          reply_markup: inlineKeyboard,
          parse_mode: "HTML",
        }
      );

      number = await conversation.wait();
    }

    await ctx.reply("Введите ваши фамилию и имя");
    let name = await isText(conversation, ctx);
    while (!/^\S+\s+\S+$/.test(name.msg.text)) {
      await ctx.reply(
        "Похоже, вы неправильно ввели ваше имя и фамилию. Попробуйте еще раз.",
        {
          reply_markup: inlineKeyboard,
        }
      );
      name = await conversation.wait();
    }

    await postNewReg(
      date,
      time.msg.text,
      serviceText.msg.text,
      number.msg.text,
      name.msg.text
    );
    JSON.parse(ADMIN).forEach((id) => {
      bot.api.sendMessage(
        id,
        `<b>Новая запись!</b>
  <i>Услуга:</i> ${serviceText.msg.text}
  <i>Дата:</i> ${nonDate.msg.text}
  <i>Время записи:</i> ${time.msg.text}
  <i>Номер телефона:</i> ${number.msg.text}
  <i>Имя:</i> ${name.msg.text}`,
        {
          parse_mode: "HTML",
        }
      );
    });

    await ctx.reply("Вы успешно записались.");
  } catch (error) {
    console.error(error);
    return ctx.reply("Ошибка");
  }
}

bot.use(createConversation(registration));
bot.command("reg", async (ctx) => {
  await ctx.conversation.enter("registration");
});

async function showRequests(conversation, ctx) {
  try {
    await ctx.reply(
      "Введите дату, за которую вы хотите посмотреть регистрации в формате: день.месяц.год. Например 01.01.2024."
    );
    let nonDate = await isText(conversation, ctx);
    while (!reg.test(nonDate.msg.text)) {
      await ctx.reply(
        `Неверно введена дата.
Напишите в формате: день.месяц.год. Например 01.01.2024.`,
        {
          reply_markup: inlineKeyboard,
        }
      );
      nonDate = await conversation.wait();
    }
    const date = nonDate.msg.text.split(".").reverse();
    const result = await connection.query(
      "SELECT * FROM Info WHERE date = ?",
      date.join("-")
    );
    if (!result[0].length) {
      await ctx.reply(`Записей на <b>${nonDate.msg.text}</b> не найдено`, {
        parse_mode: "HTML",
      });
      return false;
    }
    const str = result[0].reduce((acc, item, index) => {
      const timeSplitted = item.time.split(":");
      const newTime = timeSplitted.slice(0, timeSplitted.length - 1).join(":");
      return (
        acc +
        `
${index + 1})
<i>Услуга:</i> ${item.service}
<i>Время записи:</i> ${newTime}
<i>Номер телефона:</i> ${item.number}
<i>Имя:</i> ${item.name} \n
---------------------------------------------- \n`
      );
    }, `<b>Записи на ${nonDate.msg.text}</b> \n---------------------------------------------- \n`);
    await ctx.reply(str, {
      parse_mode: "HTML",
    });
    return [result[0]];
  } catch (error) {
    console.error(error);
    return ctx.reply("Ошибка");
  }
}

bot.use(createConversation(showRequests));
bot.command("requests", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.reply("Вы не администратор.");
  }
  await ctx.conversation.enter("showRequests");
});

async function setTime(ctx, conversation) {
  await ctx.reply(
    "Введите промежуток времени между записями (только число в минут, например 30)"
  );
  let time = await isText(conversation, ctx);
  while (isNaN(time.msg.text)) {
    await ctx.reply(
      "Неверно введено время. Введите промежуток времени между записями (только число в минут, например 30)",
      {
        reply_markup: inlineKeyboard,
      }
    );
    time = await conversation.wait();
  }
  return time;
}

async function setTimeOfStartOrEnd(ctx, conversation) {
  let timeOfStartOrEnd = await isText(conversation, ctx);
  while (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfStartOrEnd.msg.text)) {
    await ctx.reply("Похоже, вы неправильно ввели время. Попробуйте еще раз.", {
      reply_markup: inlineKeyboard,
    });
    timeOfStartOrEnd = await conversation.wait();
  }
  return timeOfStartOrEnd;
}

async function setService(ctx, conversation, data) {
  await ctx.reply("Введите название услуги", {
    reply_markup: { remove_keyboard: true },
  });
  let service = await isText(conversation, ctx);
  while (!service.msg?.text) {
    await ctx.reply("Введите корректное название услуги.", {
      reply_markup: inlineKeyboard,
    });
    service = await conversation.wait();
  }
  return service;
}

async function showServices(ctx, conversation, data) {
  const str = data.reduce((acc, item, index) => {
    return (
      acc +
      `
${index + 1})
<i>Название услуги:</i> ${item.service}
<i>Промежуток времени между записями: </i> ${item.time} минут
<i>Время начала записи:</i> ${item.timeOfStart}
<i>Время конца записи:</i> ${item.timeOfEnd}\n
---------------------------------------------- \n`
    );
  }, `<b>Ваши услуги:</b>\n---------------------------------------------- \n`);
  await ctx.reply(`${str}\nВыберите номер услуги`, {
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });

  let serviceNum = await isText(conversation, ctx);
  while (
    isNaN(serviceNum.msg.text) ||
    serviceNum.msg.text > data.length ||
    serviceNum.msg.text <= 0
  ) {
    if (isNaN(serviceNum.msg.text)) {
      await ctx.reply("Неверно введено число. Выберите номер услуги повторно", {
        reply_markup: inlineKeyboard,
      });
    } else {
      await ctx.reply(
        "Услуга по данному номеру не найдена. Попробуйте еще раз",
        {
          reply_markup: inlineKeyboard,
        }
      );
    }

    serviceNum = await conversation.wait();
  }
  return serviceNum;
}

async function editServices(conversation, ctx) {
  try {
    const what = ["Добавить услугу", "Поменять услугу", "Удалить услугу"];
    const buttonRows = what.map((label) => [Keyboard.text(label)]);
    const keyboard = Keyboard.from(buttonRows).resized().row().oneTime();
    await ctx.reply("Что вы хотите сделать?", { reply_markup: keyboard });
    let choice = await isText(conversation, ctx);
    while (!what.includes(choice.msg.text)) {
      await ctx.reply("Такого варианта нет. Выберите из списка доступных", {
        reply_markup: inlineKeyboard,
      });
      choice = await conversation.wait();
    }
    const req = await fsPromise.readFile("./services.json", "utf8");
    const data = JSON.parse(req);
    switch (choice.msg.text) {
      case "Добавить услугу":
        const service = await setService(ctx, conversation);
        const time = await setTime(ctx, conversation);
        await ctx.reply(`Введите время начала записи. Например 12:00`);
        const timeOfStart = await setTimeOfStartOrEnd(ctx, conversation);
        await ctx.reply("Введите время конца записи. Например 17:00");
        const timeOfEnd = await setTimeOfStartOrEnd(ctx, conversation);

        data.push({
          service: service.msg.text,
          time: time.msg.text,
          timeOfStart: timeOfStart.msg.text,
          timeOfEnd: timeOfEnd.msg.text,
        });
        await ctx.reply("Услуга успешно добавлена.");

        break;

      case "Поменять услугу":
        const serviceNum = await showServices(ctx, conversation, data);

        const thisService = data[parseInt(serviceNum.msg.text - 1)];

        const edit = [
          ["Название услуги", "service"],
          ["Промежуток времени между записями", "time"],
          ["Время начала записи", "timeOfStart"],
          ["Время конца записи", "timeOfEnd"],
        ];
        const buttonRowsEdit = edit.map((label) => [Keyboard.text(label[0])]);
        const keyboardEdit = Keyboard.from(buttonRowsEdit)
          .resized()
          .row()
          .oneTime();
        await ctx.reply("Что вы хотите поменять?", {
          reply_markup: keyboardEdit,
        });
        let index = 0;
        let choiceEdit = await isText(conversation, ctx);
        while (true) {
          let found = false;
          for (let i = 0; i < edit.length; i++) {
            if (edit[i].includes(choiceEdit.msg.text)) {
              index = i;
              found = true;
              break;
            }
          }
          if (found) break;
          await ctx.reply("Такого варианта нет. Выберите из списка доступных", {
            reply_markup: inlineKeyboard,
          });
          choiceEdit = await conversation.wait();
        }
        let value;
        if (edit[index][1] === "service") {
          value = await setService(ctx, conversation);
        } else if (edit[index][1] === "time") {
          value = await setTime(ctx, conversation);
        } else if (edit[index][1] === "timeOfStart") {
          await ctx.reply(`Введите время начала записи. Например 12:00`);
          value = await setTimeOfStartOrEnd(ctx, conversation);
        } else if (edit[index][1] === "timeOfEnd") {
          await ctx.reply("Введите время конца записи. Например 17:00");
          value = await setTimeOfStartOrEnd(ctx, conversation);
        } else {
          return await ctx.reply("Не найдено.");
        }

        thisService[edit[index][1]] = value.msg.text;
        await ctx.reply("Действие успешно выполнено."),
          {
            reply_markup: { remove_keyboard: true },
          };

        break;
      case "Удалить услугу":
        const serviceNumDel = await showServices(ctx, conversation, data);
        data.splice(serviceNumDel.msg.text - 1, 1);
        await ctx.reply("Услуга успешно удалена.");
        break;
      default:
        break;
    }
    await fsPromise.writeFile("./services.json", JSON.stringify(data));
  } catch (error) {
    console.error(error);
    return ctx.reply("Ошибка");
  }
}

bot.use(createConversation(editServices));
bot.command("edit_services", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.reply("Вы не администратор.");
  }
  await ctx.conversation.enter("editServices");
});

async function deleteRequest(conversation, ctx) {
  try {
    const serviceNumDel = await showRequests(conversation, ctx);
    if (!serviceNumDel) return;
    await ctx.reply("Введите номер регистрации");
    const num = await isText(conversation, ctx);
    const request = serviceNumDel[0][num.msg.text - 1];
    await connection.query("DELETE FROM Info WHERE date= ? AND time = ?", [
      request.date,
      request.time,
    ]);
    await ctx.reply("Удаление прошло успешно");
  } catch (error) {
    console.error(error);
    return ctx.reply("Ошибка");
  }
}

bot.use(createConversation(deleteRequest));
bot.command("delete_req", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return await ctx.reply("Вы не администратор.");
  }
  await ctx.conversation.enter("deleteRequest");
});

bot.command("faq", async (ctx) => {
  await ctx.reply(
    `<b>Как записаться на услугу?</b> Используйте команду /reg. Бот покажет вам доступные услуги и свободное время для записи.

<b>Какие услуги доступны?</b> Список услуг динамически обновляется. Актуальный перечень вы увидите при использовании команды /reg.

<b>Как узнать свободное время?</b> При выборе услуги бот автоматически покажет все доступные слоты для записи.

<b>Могу ли я выбрать любое время?</b> Нет, бот предложит только свободные слоты с учетом длительности каждой услуги и уже существующих записей.

<b>Что делать, если нужное мне время занято?</b> Бот предложит вам ближайшие свободные слоты. Выберите наиболее подходящий для вас.

<b>Как отменить запись?</b> Для отмены записи, пожалуйста, свяжитесь с администратором.

<b>Как часто обновляется расписание?</b> Расписание обновляется в реальном времени после каждой новой записи или отмены.

<b>Есть ли ограничения по количеству записей?</b> Нет, вы можете записываться столько раз, сколько необходимо, при наличии свободных слотов.

<b>Что делать, если у меня возникли проблемы с ботом?</b> Пожалуйста, свяжитесь с нашим администратором для получения помощи.
`,
    {
      parse_mode: "HTML",
    }
  );
});

bot.on("message", async (ctx) => {
  await ctx.reply("Введите команду.");
});

bot.api.setMyCommands([
  { command: "start", description: "Начать" },
  { command: "faq", description: "Информация о боте" },
  { command: "reg", description: "Запись" },
  {
    command: "requests",
    description: "Посмотреть записи на определенную дату",
  },
  { command: "edit_services", description: "Изменить услуги" },
  {
    command: "delete_req",
    description: "Удалить запись на определенное время",
  },
]);

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Ошибка при обработке обновления ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Ошибка при запросе:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Не могу связаться с Телеграм:", e);
  } else {
    console.error("Неизвестная ошибка:", e);
  }
});
bot.start();

export { connection };
