"use strict";

var persistentRessources = null;

function GameVisualization(assets, snakeMoveStrategy, container, readyfunc)
{
    this.container = container;
    this.snakeMoveStrategy = snakeMoveStrategy;
    this.snakes = {};
    this.follow_name = null;
    this.follow_scale = false;
    this.nextFoodDecayRow = 0;
    this.world_size_x = 1024;
    this.world_size_y = 1024;
    this.food_decay_rate = 0.001;
    this.foodItems = {};

    this.app = new PIXI.Application({'transparent':false});
    this.viewport = new PIXI.extras.Viewport({
        screenWidth: this.container.clientWidth,
        screenHeight: this.container.clientHeight,
        worldWidth: this.world_size_x,
        worldHeight: this.world_size_y,
        interaction: this.app.renderer.plugins.interaction
    });
    this.viewport.ticker.remove(this.viewport.tickerFunction);

    this.app.stage.addChild(this.viewport);
    this.viewport.drag().pinch().wheel();

    this.foodContainer = this.viewport.addChild(new PIXI.Container());
    this.snakesContainer = this.viewport.addChild(new PIXI.Container());
    this.snakesMask = this.viewport.addChild(new PIXI.Graphics());
    this.snakesContainer.mask = this.snakesMask;
    this.UpdateMask();

    let self = this;
    this.assets = assets;
    if (persistentRessources)
    {
        self.txHead = persistentRessources.txHead;
        self.txBody = persistentRessources.txBody;
        self.txFood = persistentRessources.txFood;
        self.segmentPool = persistentRessources.segmentPool;
        self.foodItemPool = persistentRessources.foodItemPool;
        readyfunc();
        return;
    }

    PIXI.loader.add([assets['head.png'], assets['body.png'], assets['food.png']]).load(function() {
        persistentRessources =
        {
            'txHead': PIXI.loader.resources[self.assets['head.png']].texture,
            'txBody': PIXI.loader.resources[self.assets['body.png']].texture,
            'txFood': PIXI.loader.resources[self.assets['food.png']].texture,
        };
        self.txHead = persistentRessources.txHead;
        self.txBody = persistentRessources.txBody;
        self.txFood = persistentRessources.txFood;

        persistentRessources.segmentPool = new ObjectPool(function() {
            return new SnakeSegment(self.txBody);
        }, self, 10000);
        persistentRessources.foodItemPool = new ObjectPool(function() {
            return new FoodSprite(self.txFood);
        }, self, 10000);

        self.segmentPool = persistentRessources.segmentPool;
        self.foodItemPool = persistentRessources.foodItemPool;

        readyfunc();
    });
}

GameVisualization.prototype.UpdateMask = function()
{
    this.snakesMask.clear();
    this.snakesMask.lineStyle(0);
    this.snakesMask.beginFill(0x000000, 0.5);
    this.snakesMask.drawRect(0, 0, this.world_size_x, this.world_size_y);
    this.snakesMask.endFill();
};

GameVisualization.prototype.Run = function()
{
    this.container.appendChild(this.app.view);
    this.Resize();
    this.app.ticker.add(this.GameTick, this);
};

GameVisualization.prototype.Resize = function()
{
    this.GetRenderer().resize(this.container.clientWidth, this.container.clientHeight);
};

GameVisualization.prototype.GetRenderer = function()
{
    return this.app.renderer;
};

GameVisualization.prototype.GetSnake = function(id)
{
    return this.snakes[id];
};

GameVisualization.prototype.GameTick = function(delta)
{
    this.UpdateStagePosition();
};

GameVisualization.prototype.CreateSnake = function(bot)
{
    let snake = new Snake(this.txHead, this.segmentPool, bot.name, bot.color, this.world_size_x, this.world_size_y);
    snake.snake_id = bot.id;
    snake.db_id = bot.db_id;
    this.snakes[bot.id] = snake;
    this.snakesContainer.addChild(snake.Container);
    snake.GetNameSprite().on('click', function() { this.FollowName(bot.name, false); }, this);
    snake.GetHeadSprite().on('click', function() { this.FollowName(bot.name, false); }, this);

    if (snake.GetName() == this.follow_name)
    {
        this.FollowName(bot.name, this.follow_scale);
    }

    return snake;
};

GameVisualization.prototype.RemoveSnake = function(id)
{
    if (id in this.snakes)
    {
        this.snakes[id].Destroy();
        delete this.snakes[id];
    }
};

GameVisualization.prototype.HandleGameInfoMessage = function(world_size_x, world_size_y, food_decay_rate)
{
    console.log("GameInfo received");
    this.world_size_x = world_size_x;
    this.world_size_y = world_size_y;
    this.food_decay_rate = food_decay_rate;
    this.foodMap = new ParticleGeoMap(this.world_size_x, this.world_size_y, 64, 64);
    this.foodContainer.removeChildren();
    this.foodContainer.addChild(this.foodMap.Container);
    this.UpdateMask();
    this.viewport.resize(this.container.clientWidth, this.container.clientHeight, this.world_size_x, this.world_size_y);
    this.viewport.fitWidth();
};

GameVisualization.prototype.HandleTickMessage = function(frame_id)
{
    for (let snake_id in this.snakes)
    {
        this.snakes[snake_id].AnimateEat();
    }

    let nth = 16;
    this.nextFoodDecayRow = (this.nextFoodDecayRow + 1) % nth;

    if (this.nextFoodDecayRow == 0)
    {
        for (let food_id in this.foodItems)
        {
            let item = this.foodItems[food_id];
            item.Decay(nth);
            if (item.request_garbage_collect)
            {
                delete this.foodItems[food_id];
                this.foodItemPool.free(item);
            }
        }
        this.foodMap.GarbageCollect();
    }
};

GameVisualization.prototype.HandleWorldUpdateMessage = function(data)
{
    console.log("WorldUpdate received");
    for (let id in data.bots)
    {
        let bot = data.bots[id];
        if (!(bot.id in this.snakes))
        {
            this.CreateSnake(bot);
        }
        this.snakes[bot.id].SetData(bot);
    }

    for (let id in this.snakes)
    {
        if (!(id in data.bots))
        {
            this.RemoveSnake(id);
        }
    }

    for (let id in data.food)
    {
        let food = data.food[id];
        this.AddFood(food.id, food.pos_x, food.pos_y, food.value);
    }
};

GameVisualization.prototype.AddFood = function(food_id, pos_x, pos_y, value)
{
    let sprite = this.foodItemPool.get();
    sprite.SetData(this.food_decay_rate, food_id, pos_x, pos_y, value);
    this.foodItems[food_id] = sprite;
    this.foodMap.AddSprite(sprite);
};

GameVisualization.prototype.HandleBotSpawnMessage = function(bot)
{
    this.CreateSnake(bot);
};

GameVisualization.prototype.HandleBotKilledMessage = function(killer_id, victim_id)
{
    this.RemoveSnake(victim_id);
};

GameVisualization.prototype.HandleFoodSpawnMessage = function(food_id, pos_x, pos_y, value)
{
    this.AddFood(food_id, pos_x, pos_y, value);
};

GameVisualization.prototype.HandleFoodConsumedMessage = function(food_id, consumer_id)
{
    if (food_id in this.foodItems)
    {
        let sprite = this.foodItems[food_id];
        if (consumer_id in this.snakes)
        {
            this.snakes[consumer_id].Eat(sprite);
        }
        else
        {
            this.foodItems[food_id].visible = false;
            delete this.foodItems[food_id];
            this.foodItemPool.free(sprite);
        }
    }
};

GameVisualization.prototype.HandleFoodDecayedMessage = function(food_id)
{
    if (food_id in this.foodItems)
    {
        let sprite = this.foodItems[food_id];
        sprite.visible = false;
    }
};

GameVisualization.prototype.HandleBotMovedMessage = function(bot_id, segment_data, length, segment_radius)
{
    if (bot_id in this.snakes)
    {
        this.snakeMoveStrategy.OldStyleMove(this.snakes[bot_id], segment_data, length, segment_radius);
        this.snakes[bot_id].UpdateHead();
    }
};

GameVisualization.prototype.HandleBotMoveHeadMessage = function(bot_id, mass, positions)
{
    if (bot_id in this.snakes)
    {
        this.snakeMoveStrategy.NewStyleMove(this.snakes[bot_id], mass, positions);
        this.viewport.update();
    }
};

GameVisualization.prototype.FollowName = function(name, changeZoomLevel)
{
    this.follow_name = name;
    this.follow_scale = changeZoomLevel;
    for (let id in this.snakes)
    {
        let snake = this.snakes[id];
        if (snake.GetName() == this.follow_name)
        {
            $("#followmsg>span>span").text(this.follow_name);
            $("#followmsg").show();
            this.viewport.follow(snake.GetHeadSprite(), { radius: 0 });
            if (changeZoomLevel)
            {
                let scale = 0.25/snake.spriteScale;
                this.viewport.scale.x = scale;
                this.viewport.scale.y = scale;
            }
        }
    }
};

GameVisualization.prototype.Unfollow = function()
{
    this.follow_name = null;
    this.viewport.pausePlugin('follow');
};

GameVisualization.prototype.UpdateStagePosition = function()
{
    if ((++this.updateVisibilityCounter < 25) || (!this.foodMap))
    {
        return;
    }
    this.updateVisibilityCounter = 0;

    const center = this.viewport.center;
    const width = this.viewport.right - this.viewport.left;
    const height = this.viewport.bottom - this.viewport.top;

    this.foodMap.Update(center.x, center.y, width, height);

    const minimumVisibleFoodSize = 0.5 / this.viewport.scale.x;
    this.foodMap.Iterate(function(foodSprite) {
        foodSprite.visible = foodSprite.food_value > minimumVisibleFoodSize;
    });

};
